BEGIN;

ALTER TABLE polling_results
  ADD COLUMN IF NOT EXISTS temporal_scope TEXT;

UPDATE polling_results
SET temporal_scope = CASE
  WHEN cycle IS NOT NULL THEN 'election_cycle'
  WHEN LOWER(COALESCE(poll_type, '')) IN ('approval', 'favorability')
    THEN 'continuous_tracking'
  ELSE 'unresolved'
END
WHERE temporal_scope IS NULL
   OR temporal_scope NOT IN ('election_cycle', 'continuous_tracking', 'unresolved');

ALTER TABLE polling_results
  ALTER COLUMN temporal_scope SET DEFAULT 'unresolved',
  ALTER COLUMN temporal_scope SET NOT NULL;

ALTER TABLE polling_results
  DROP CONSTRAINT IF EXISTS polling_results_temporal_scope_check,
  ADD CONSTRAINT polling_results_temporal_scope_check
    CHECK (temporal_scope IN ('election_cycle', 'continuous_tracking', 'unresolved')),
  DROP CONSTRAINT IF EXISTS polling_results_temporal_scope_cycle_check,
  ADD CONSTRAINT polling_results_temporal_scope_cycle_check CHECK (
    (temporal_scope = 'election_cycle' AND cycle IS NOT NULL)
    OR (temporal_scope IN ('continuous_tracking', 'unresolved') AND cycle IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_polling_results_temporal_scope_cycle
  ON polling_results (temporal_scope, cycle, poll_type);

ALTER TABLE polling_ingestion_quarantine
  ADD COLUMN IF NOT EXISTS temporal_scope TEXT NOT NULL DEFAULT 'unresolved';

ALTER TABLE polling_ingestion_quarantine
  DROP CONSTRAINT IF EXISTS polling_ingestion_quarantine_temporal_scope_check,
  ADD CONSTRAINT polling_ingestion_quarantine_temporal_scope_check
    CHECK (temporal_scope IN ('election_cycle', 'continuous_tracking', 'unresolved'));

CREATE OR REPLACE FUNCTION enforce_new_polling_result_cycle()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.temporal_scope = 'election_cycle' AND NEW.cycle IS NULL THEN
    RAISE EXCEPTION 'Election-cycle polling requires a deterministic cycle';
  END IF;

  IF NEW.temporal_scope = 'continuous_tracking' AND NEW.cycle IS NOT NULL THEN
    RAISE EXCEPTION 'Continuous-tracking polling must not carry an election cycle';
  END IF;

  IF NEW.temporal_scope = 'unresolved' THEN
    RAISE EXCEPTION 'Unresolved polling must be quarantined before insertion';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_new_polling_result_cycle ON polling_results;
CREATE TRIGGER trg_enforce_new_polling_result_cycle
  BEFORE INSERT OR UPDATE OF cycle, temporal_scope ON polling_results
  FOR EACH ROW
  EXECUTE FUNCTION enforce_new_polling_result_cycle();

COMMIT;
