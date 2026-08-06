-- VoterSpheres Build 5.7 - Unified Polling Intelligence
-- Canonical source of truth: polling_results

CREATE TABLE IF NOT EXISTS polling_results (
  id BIGSERIAL PRIMARY KEY
);

ALTER TABLE polling_results
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS poll_id TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_dataset TEXT,
  ADD COLUMN IF NOT EXISTS poll_type TEXT,
  ADD COLUMN IF NOT EXISTS pollster TEXT,
  ADD COLUMN IF NOT EXISTS sponsor TEXT,
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS district TEXT,
  ADD COLUMN IF NOT EXISTS office TEXT,
  ADD COLUMN IF NOT EXISTS race_name TEXT,
  ADD COLUMN IF NOT EXISTS candidate_name TEXT,
  ADD COLUMN IF NOT EXISTS candidate_id TEXT,
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
  ADD COLUMN IF NOT EXISTS partisan TEXT,
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

CREATE INDEX IF NOT EXISTS idx_polling_results_poll_id
  ON polling_results (poll_id);

CREATE INDEX IF NOT EXISTS idx_polling_results_poll_type
  ON polling_results (poll_type);

CREATE INDEX IF NOT EXISTS idx_polling_results_state
  ON polling_results (state);

CREATE INDEX IF NOT EXISTS idx_polling_results_subject
  ON polling_results (subject);

CREATE INDEX IF NOT EXISTS idx_polling_results_field_end
  ON polling_results (field_end DESC);

CREATE INDEX IF NOT EXISTS idx_polling_results_pollster
  ON polling_results (pollster);

CREATE TABLE IF NOT EXISTS polling_ingestion_runs (
  id BIGSERIAL PRIMARY KEY,
  run_key TEXT UNIQUE NOT NULL,
  provider TEXT NOT NULL DEFAULT 'votehub',
  status TEXT NOT NULL DEFAULT 'running',
  request_count INTEGER NOT NULL DEFAULT 0,
  fetched_poll_count INTEGER NOT NULL DEFAULT 0,
  normalized_answer_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_polling_ingestion_runs_started
  ON polling_ingestion_runs (started_at DESC);

-- Preserve the legacy table if it exists, but the active application should
-- read from and write to polling_results only.