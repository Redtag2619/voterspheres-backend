BEGIN;

 

CREATE TABLE IF NOT EXISTS polling_cycle_remediation_batches (

  id BIGSERIAL PRIMARY KEY,

  status TEXT NOT NULL DEFAULT 'applying',

  mapping_sha256 TEXT NOT NULL,

  records_planned INTEGER NOT NULL,

  records_applied INTEGER NOT NULL DEFAULT 0,

  cycle_counts JSONB NOT NULL DEFAULT '{}'::jsonb,

  applied_by TEXT,

  applied_at TIMESTAMPTZ,

  rolled_back_by TEXT,

  rolled_back_at TIMESTAMPTZ,

  rollback_note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT polling_cycle_remediation_batch_status_check

    CHECK (status IN ('applying', 'applied', 'rolled_back')),

  CONSTRAINT polling_cycle_remediation_batch_sha_check

    CHECK (mapping_sha256 ~ '^[a-f0-9]{64}$'),

  CONSTRAINT polling_cycle_remediation_batch_counts_check

    CHECK (records_planned > 0 AND records_applied >= 0 AND records_applied <= records_planned)

);

 

CREATE TABLE IF NOT EXISTS polling_cycle_remediation_items (

  id BIGSERIAL PRIMARY KEY,

  batch_id BIGINT NOT NULL REFERENCES polling_cycle_remediation_batches(id) ON DELETE RESTRICT,

  polling_result_id BIGINT NOT NULL,

  poll_group_key TEXT NOT NULL,

  previous_cycle INTEGER,

  applied_cycle INTEGER NOT NULL REFERENCES election_cycles(cycle_year),

  evidence JSONB NOT NULL,

  reason TEXT NOT NULL,

  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  rolled_back_at TIMESTAMPTZ,

  CONSTRAINT polling_cycle_remediation_item_previous_check

    CHECK (previous_cycle IS NULL OR (previous_cycle BETWEEN 2026 AND 2200 AND previous_cycle % 2 = 0)),

  CONSTRAINT polling_cycle_remediation_item_applied_check

    CHECK (applied_cycle BETWEEN 2026 AND 2200 AND applied_cycle % 2 = 0),

  CONSTRAINT polling_cycle_remediation_item_unique

    UNIQUE (batch_id, polling_result_id)

);

 

CREATE INDEX IF NOT EXISTS idx_polling_cycle_remediation_batches_status

  ON polling_cycle_remediation_batches (status, created_at DESC);

 

CREATE INDEX IF NOT EXISTS idx_polling_cycle_remediation_items_polling_result

  ON polling_cycle_remediation_items (polling_result_id, applied_at DESC);

 

CREATE UNIQUE INDEX IF NOT EXISTS uq_polling_cycle_active_remediation

  ON polling_cycle_remediation_items (polling_result_id)

  WHERE rolled_back_at IS NULL;

 

COMMIT;
