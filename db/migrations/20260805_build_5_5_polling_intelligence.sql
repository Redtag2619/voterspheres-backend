
-- VoterSpheres Build 5.5
-- Polling Intelligence Engine
-- Safe for existing databases: creates or extends polling_results.

CREATE TABLE IF NOT EXISTS polling_results (
  id BIGSERIAL PRIMARY KEY
);

ALTER TABLE polling_results
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS poll_id TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_dataset TEXT,
  ADD COLUMN IF NOT EXISTS pollster TEXT,
  ADD COLUMN IF NOT EXISTS sponsor TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS district TEXT,
  ADD COLUMN IF NOT EXISTS office TEXT,
  ADD COLUMN IF NOT EXISTS race_name TEXT,
  ADD COLUMN IF NOT EXISTS candidate_name TEXT,
  ADD COLUMN IF NOT EXISTS party TEXT,
  ADD COLUMN IF NOT EXISTS answer TEXT,
  ADD COLUMN IF NOT EXISTS pct NUMERIC,
  ADD COLUMN IF NOT EXISTS field_start DATE,
  ADD COLUMN IF NOT EXISTS field_end DATE,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sample_size INTEGER,
  ADD COLUMN IF NOT EXISTS population TEXT,
  ADD COLUMN IF NOT EXISTS methodology TEXT,
  ADD COLUMN IF NOT EXISTS mode TEXT,
  ADD COLUMN IF NOT EXISTS margin_of_error NUMERIC,
  ADD COLUMN IF NOT EXISTS cycle INTEGER,
  ADD COLUMN IF NOT EXISTS election_date DATE,
  ADD COLUMN IF NOT EXISTS record_type TEXT NOT NULL DEFAULT 'measured_poll',
  ADD COLUMN IF NOT EXISTS is_estimate BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC NOT NULL DEFAULT 75,
  ADD COLUMN IF NOT EXISTS freshness_score NUMERIC NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_polling_results_dedupe_key
  ON polling_results (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_polling_results_state
  ON polling_results (state);

CREATE INDEX IF NOT EXISTS idx_polling_results_office
  ON polling_results (office);

CREATE INDEX IF NOT EXISTS idx_polling_results_candidate
  ON polling_results (candidate_name);

CREATE INDEX IF NOT EXISTS idx_polling_results_field_end
  ON polling_results (field_end DESC);

CREATE INDEX IF NOT EXISTS idx_polling_results_cycle
  ON polling_results (cycle);

CREATE INDEX IF NOT EXISTS idx_polling_results_record_type
  ON polling_results (record_type);

CREATE TABLE IF NOT EXISTS polling_ingestion_runs (
  id BIGSERIAL PRIMARY KEY,
  run_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  source_count INTEGER NOT NULL DEFAULT 0,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  normalized_count INTEGER NOT NULL DEFAULT 0,
  stored_count INTEGER NOT NULL DEFAULT 0,
  estimate_count INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_polling_ingestion_runs_started
  ON polling_ingestion_runs (started_at DESC);
