BEGIN;

CREATE TABLE IF NOT EXISTS polling_ingestion_quarantine (
  id BIGSERIAL PRIMARY KEY,
  run_key TEXT,
  provider TEXT NOT NULL,
  poll_id TEXT,
  poll_group_key TEXT NOT NULL,
  issue_code TEXT NOT NULL,
  proposed_cycle INTEGER REFERENCES election_cycles(cycle_year),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  normalized_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  released_cycle INTEGER REFERENCES election_cycles(cycle_year),
  released_by TEXT,
  released_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT polling_ingestion_quarantine_status_check
    CHECK (status IN ('pending', 'released', 'ignored')),
  CONSTRAINT polling_ingestion_quarantine_cycle_check
    CHECK (
      (proposed_cycle IS NULL OR (proposed_cycle BETWEEN 2026 AND 2200 AND proposed_cycle % 2 = 0))
      AND
      (released_cycle IS NULL OR (released_cycle BETWEEN 2026 AND 2200 AND released_cycle % 2 = 0))
    ),
  CONSTRAINT polling_ingestion_quarantine_group_unique
    UNIQUE (provider, poll_group_key, issue_code, status)
);

CREATE INDEX IF NOT EXISTS idx_polling_ingestion_quarantine_status
  ON polling_ingestion_quarantine (status, provider, created_at DESC);

ALTER TABLE polling_ingestion_runs
  ADD COLUMN IF NOT EXISTS quarantined_poll_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quarantined_answer_count INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION enforce_new_polling_result_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cycle IS NULL THEN
    RAISE EXCEPTION 'New polling_results rows require a deterministic registered election cycle'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_polling_results_require_cycle_on_insert ON polling_results;

CREATE TRIGGER trg_polling_results_require_cycle_on_insert
BEFORE INSERT ON polling_results
FOR EACH ROW
EXECUTE FUNCTION enforce_new_polling_result_cycle();

COMMIT;
