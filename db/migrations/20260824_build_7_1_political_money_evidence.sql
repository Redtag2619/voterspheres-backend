CREATE TABLE IF NOT EXISTS political_money_organizations (
  id BIGSERIAL PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  organization_type TEXT NOT NULL DEFAULT 'unknown',
  tax_exempt_subsection TEXT,
  state CHAR(2),
  city TEXT,
  address TEXT,
  website TEXT,
  formation_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pmo_normalized_name
  ON political_money_organizations(normalized_name);
CREATE INDEX IF NOT EXISTS idx_pmo_type_state
  ON political_money_organizations(organization_type, state);

CREATE TABLE IF NOT EXISTS political_money_identifiers (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES political_money_organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  identifier_type TEXT NOT NULL,
  identifier_value TEXT NOT NULL,
  confidence_score INTEGER NOT NULL DEFAULT 100 CHECK (confidence_score BETWEEN 0 AND 100),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, identifier_type, identifier_value)
);

CREATE INDEX IF NOT EXISTS idx_pmi_organization
  ON political_money_identifiers(organization_id);

CREATE TABLE IF NOT EXISTS political_money_ingestion_runs (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  job_type TEXT NOT NULL,
  cycle INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  pages_requested INTEGER NOT NULL DEFAULT 0,
  records_fetched INTEGER NOT NULL DEFAULT 0,
  records_stored INTEGER NOT NULL DEFAULT 0,
  records_failed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pmir_provider_started
  ON political_money_ingestion_runs(provider, started_at DESC);

CREATE TABLE IF NOT EXISTS political_money_transactions (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  cycle INTEGER,
  source_organization_id BIGINT REFERENCES political_money_organizations(id) ON DELETE SET NULL,
  target_organization_id BIGINT REFERENCES political_money_organizations(id) ON DELETE SET NULL,
  fec_committee_id TEXT,
  fec_candidate_id TEXT,
  candidate_name TEXT,
  support_oppose_indicator TEXT,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  transaction_date DATE,
  dissemination_date DATE,
  purpose TEXT,
  source_url TEXT,
  filing_id TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_pmt_cycle_type
  ON political_money_transactions(cycle, transaction_type);
CREATE INDEX IF NOT EXISTS idx_pmt_source_org
  ON political_money_transactions(source_organization_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_pmt_candidate
  ON political_money_transactions(fec_candidate_id, cycle);

CREATE TABLE IF NOT EXISTS political_money_evidence (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES political_money_organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  observed_at TIMESTAMPTZ,
  source_url TEXT,
  confidence_score INTEGER NOT NULL DEFAULT 50 CHECK (confidence_score BETWEEN 0 AND 100),
  reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by BIGINT,
  reviewed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, evidence_type, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_pme_org_type
  ON political_money_evidence(organization_id, evidence_type);
CREATE INDEX IF NOT EXISTS idx_pme_reviewed
  ON political_money_evidence(reviewed, created_at DESC);

CREATE TABLE IF NOT EXISTS political_money_scores (
  organization_id BIGINT PRIMARY KEY REFERENCES political_money_organizations(id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  cycle INTEGER,
  disclosure_gap_score INTEGER NOT NULL DEFAULT 0,
  nonprofit_spending_score INTEGER NOT NULL DEFAULT 0,
  independent_expenditure_score INTEGER NOT NULL DEFAULT 0,
  organization_transfer_score INTEGER NOT NULL DEFAULT 0,
  shell_organization_score INTEGER NOT NULL DEFAULT 0,
  dark_money_score INTEGER NOT NULL DEFAULT 0,
  indicator_count INTEGER NOT NULL DEFAULT 0,
  review_tier TEXT NOT NULL DEFAULT 'standard',
  human_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pms_dark_money_score
  ON political_money_scores(dark_money_score DESC);
CREATE INDEX IF NOT EXISTS idx_pms_review_tier
  ON political_money_scores(review_tier, human_review_required);
