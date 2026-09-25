
BEGIN;

CREATE TABLE IF NOT EXISTS election_cycle_remediation_queue (
  id BIGSERIAL PRIMARY KEY,
  entity_table TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  issue_code TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  proposed_cycle INTEGER,
  resolved_cycle INTEGER REFERENCES election_cycles(cycle_year),
  resolved_by_user_id BIGINT,
  resolution_note TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT election_cycle_remediation_status_check
    CHECK (status IN ('pending', 'resolved', 'ignored')),
  CONSTRAINT election_cycle_remediation_proposed_cycle_check
    CHECK (proposed_cycle IS NULL OR (proposed_cycle BETWEEN 2026 AND 2200 AND proposed_cycle % 2 = 0)),
  CONSTRAINT election_cycle_remediation_resolved_cycle_check
    CHECK (resolved_cycle IS NULL OR (resolved_cycle BETWEEN 2026 AND 2200 AND resolved_cycle % 2 = 0)),
  CONSTRAINT election_cycle_remediation_unique_issue
    UNIQUE (entity_table, entity_id, issue_code)
);

CREATE INDEX IF NOT EXISTS idx_cycle_remediation_status
  ON election_cycle_remediation_queue (status, entity_table, created_at DESC);

DO $$
BEGIN
  IF to_regclass('public.candidates') IS NOT NULL THEN
    ALTER TABLE candidates
      ADD COLUMN IF NOT EXISTS cycle_resolution_status TEXT;

    UPDATE candidates
    SET cycle_resolution_status = CASE
      WHEN election_year IS NULL THEN 'legacy_unresolved'
      ELSE 'confirmed'
    END
    WHERE cycle_resolution_status IS NULL;

    ALTER TABLE candidates
      ALTER COLUMN cycle_resolution_status SET DEFAULT 'legacy_unresolved',
      ALTER COLUMN cycle_resolution_status SET NOT NULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'candidates_cycle_resolution_status_check'
    ) THEN
      ALTER TABLE candidates ADD CONSTRAINT candidates_cycle_resolution_status_check
        CHECK (cycle_resolution_status IN ('confirmed', 'legacy_unresolved', 'manual_review'));
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'candidates_election_year_even_check'
    ) THEN
      ALTER TABLE candidates ADD CONSTRAINT candidates_election_year_even_check
        CHECK (election_year IS NULL OR (election_year BETWEEN 2026 AND 2200 AND election_year % 2 = 0));
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'candidates_election_year_registry_fk'
    ) THEN
      ALTER TABLE candidates ADD CONSTRAINT candidates_election_year_registry_fk
        FOREIGN KEY (election_year) REFERENCES election_cycles(cycle_year) NOT VALID;
      ALTER TABLE candidates VALIDATE CONSTRAINT candidates_election_year_registry_fk;
    END IF;

    CREATE INDEX IF NOT EXISTS idx_candidates_election_year_resolution
      ON candidates (election_year, cycle_resolution_status);

    INSERT INTO election_cycle_remediation_queue (
      entity_table,
      entity_id,
      issue_code,
      evidence
    )
    SELECT
      'candidates',
      c.id::text,
      'missing_election_cycle',
      jsonb_strip_nulls(jsonb_build_object(
        'candidate_id', c.id,
        'fec_candidate_id', c.fec_candidate_id,
        'name', COALESCE(c.name, c.full_name),
        'state', c.state,
        'office', c.office,
        'election', c.election
      ))
    FROM candidates c
    WHERE c.election_year IS NULL
    ON CONFLICT (entity_table, entity_id, issue_code)
    DO UPDATE SET
      evidence = EXCLUDED.evidence,
      updated_at = NOW();
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.workspaces') IS NOT NULL THEN
    ALTER TABLE workspaces
      ADD COLUMN IF NOT EXISTS election_cycle_year INTEGER;

    UPDATE workspaces w
    SET election_cycle_year = w.cycle::integer
    WHERE w.election_cycle_year IS NULL
      AND BTRIM(COALESCE(w.cycle, '')) ~ '^[0-9]{4}$'
      AND w.cycle::integer BETWEEN 2026 AND 2200
      AND w.cycle::integer % 2 = 0
      AND EXISTS (
        SELECT 1 FROM election_cycles ec WHERE ec.cycle_year = w.cycle::integer
      );

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_election_cycle_year_even_check'
    ) THEN
      ALTER TABLE workspaces ADD CONSTRAINT workspaces_election_cycle_year_even_check
        CHECK (election_cycle_year IS NULL OR (election_cycle_year BETWEEN 2026 AND 2200 AND election_cycle_year % 2 = 0));
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_election_cycle_year_registry_fk'
    ) THEN
      ALTER TABLE workspaces ADD CONSTRAINT workspaces_election_cycle_year_registry_fk
        FOREIGN KEY (election_cycle_year) REFERENCES election_cycles(cycle_year) NOT VALID;
      ALTER TABLE workspaces VALIDATE CONSTRAINT workspaces_election_cycle_year_registry_fk;
    END IF;

    CREATE INDEX IF NOT EXISTS idx_workspaces_firm_cycle
      ON workspaces (firm_id, election_cycle_year);

    INSERT INTO election_cycle_remediation_queue (entity_table, entity_id, issue_code, evidence)
    SELECT
      'workspaces',
      w.id::text,
      'missing_or_invalid_election_cycle',
      jsonb_strip_nulls(jsonb_build_object('workspace_id', w.id, 'name', w.name, 'legacy_cycle', w.cycle))
    FROM workspaces w
    WHERE w.election_cycle_year IS NULL
    ON CONFLICT (entity_table, entity_id, issue_code)
    DO UPDATE SET evidence = EXCLUDED.evidence, updated_at = NOW();
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.fundraising_live') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fundraising_live_election_year_even_check'
    ) THEN
      ALTER TABLE fundraising_live ADD CONSTRAINT fundraising_live_election_year_even_check
        CHECK (election_year BETWEEN 2026 AND 2200 AND election_year % 2 = 0);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fundraising_live_election_year_registry_fk'
    ) THEN
      ALTER TABLE fundraising_live ADD CONSTRAINT fundraising_live_election_year_registry_fk
        FOREIGN KEY (election_year) REFERENCES election_cycles(cycle_year) NOT VALID;
      ALTER TABLE fundraising_live VALIDATE CONSTRAINT fundraising_live_election_year_registry_fk;
    END IF;

    CREATE INDEX IF NOT EXISTS idx_fundraising_live_cycle
      ON fundraising_live (election_year);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.polling_results') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'polling_results_cycle_even_check'
    ) THEN
      ALTER TABLE polling_results ADD CONSTRAINT polling_results_cycle_even_check
        CHECK (cycle IS NULL OR (cycle BETWEEN 2026 AND 2200 AND cycle % 2 = 0)) NOT VALID;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'polling_results_cycle_registry_fk'
    ) THEN
      ALTER TABLE polling_results ADD CONSTRAINT polling_results_cycle_registry_fk
        FOREIGN KEY (cycle) REFERENCES election_cycles(cycle_year) NOT VALID;
    END IF;

    CREATE INDEX IF NOT EXISTS idx_polling_results_cycle
      ON polling_results (cycle);

    INSERT INTO election_cycle_remediation_queue (entity_table, entity_id, issue_code, evidence)
    SELECT 'polling_results', p.id::text, 'missing_election_cycle', jsonb_build_object('polling_result_id', p.id)
    FROM polling_results p
    WHERE p.cycle IS NULL
    ON CONFLICT (entity_table, entity_id, issue_code) DO NOTHING;
  END IF;
END $$;

COMMIT;
