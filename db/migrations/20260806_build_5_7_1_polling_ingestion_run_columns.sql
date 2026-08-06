-- VoterSpheres Build 5.7.1
-- Upgrade the existing polling_ingestion_runs table for Unified Polling Intelligence.

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

ALTER TABLE polling_ingestion_runs
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'votehub',
  ADD COLUMN IF NOT EXISTS poll_type TEXT,
  ADD COLUMN IF NOT EXISTS source_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fetched_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS normalized_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stored_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimate_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_polling_ingestion_runs_provider
  ON polling_ingestion_runs (provider);

CREATE INDEX IF NOT EXISTS idx_polling_ingestion_runs_started_at
  ON polling_ingestion_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_polling_ingestion_runs_status
  ON polling_ingestion_runs (status);