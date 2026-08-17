CREATE TABLE IF NOT EXISTS universal_candidate_entities (

  id BIGSERIAL PRIMARY KEY,

  canonical_name TEXT NOT NULL,

  normalized_name TEXT NOT NULL,

  first_name TEXT,

  middle_name TEXT,

  last_name TEXT,

  suffix TEXT,

  party TEXT,

  home_state TEXT,

  website TEXT,

  photo_url TEXT,

  biography TEXT,

  status TEXT NOT NULL DEFAULT 'active',

  verification_status TEXT NOT NULL DEFAULT 'unverified',

  confidence_score NUMERIC NOT NULL DEFAULT 50,

  source_updated_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

);

 

CREATE INDEX IF NOT EXISTS idx_universal_candidate_entities_name

  ON universal_candidate_entities (normalized_name);

CREATE INDEX IF NOT EXISTS idx_universal_candidate_entities_state

  ON universal_candidate_entities (home_state);

 

CREATE TABLE IF NOT EXISTS universal_candidate_aliases (

  id BIGSERIAL PRIMARY KEY,

  candidate_entity_id BIGINT NOT NULL REFERENCES universal_candidate_entities(id) ON DELETE CASCADE,

  alias TEXT NOT NULL,

  normalized_alias TEXT NOT NULL,

  alias_type TEXT NOT NULL DEFAULT 'name',

  source TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (candidate_entity_id, normalized_alias)

);

 

CREATE INDEX IF NOT EXISTS idx_universal_candidate_aliases_normalized

  ON universal_candidate_aliases (normalized_alias);

 

CREATE TABLE IF NOT EXISTS universal_candidate_identifiers (

  id BIGSERIAL PRIMARY KEY,

  candidate_entity_id BIGINT NOT NULL REFERENCES universal_candidate_entities(id) ON DELETE CASCADE,

  provider TEXT NOT NULL,

  identifier_type TEXT NOT NULL,

  identifier_value TEXT NOT NULL,

  cycle INTEGER,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  verified BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (provider, identifier_type, identifier_value)

);

 

CREATE INDEX IF NOT EXISTS idx_universal_candidate_identifiers_entity

  ON universal_candidate_identifiers (candidate_entity_id);

 

CREATE TABLE IF NOT EXISTS universal_elections (

  id BIGSERIAL PRIMARY KEY,

  election_key TEXT NOT NULL UNIQUE,

  election_name TEXT NOT NULL,

  election_date DATE,

  cycle INTEGER,

  election_type TEXT,

  office_level TEXT NOT NULL,

  office_name TEXT NOT NULL,

  state TEXT,

  county TEXT,

  locality TEXT,

  district TEXT,

  jurisdiction_name TEXT,

  jurisdiction_type TEXT,

  status TEXT NOT NULL DEFAULT 'scheduled',

  source TEXT,

  source_url TEXT,

  source_updated_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

);

 

CREATE INDEX IF NOT EXISTS idx_universal_elections_scope

  ON universal_elections (cycle, state, office_level, office_name);

CREATE INDEX IF NOT EXISTS idx_universal_elections_locality

  ON universal_elections (state, county, locality);

 

CREATE TABLE IF NOT EXISTS universal_candidacies (

  id BIGSERIAL PRIMARY KEY,

  candidate_entity_id BIGINT NOT NULL REFERENCES universal_candidate_entities(id) ON DELETE CASCADE,

  election_id BIGINT REFERENCES universal_elections(id) ON DELETE SET NULL,

  office_level TEXT NOT NULL,

  office_name TEXT NOT NULL,

  state TEXT,

  county TEXT,

  locality TEXT,

  district TEXT,

  cycle INTEGER,

  party TEXT,

  ballot_status TEXT,

  incumbent BOOLEAN NOT NULL DEFAULT FALSE,

  filing_status TEXT,

  source TEXT,

  source_url TEXT,

  source_updated_at TIMESTAMPTZ,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

);

 

CREATE INDEX IF NOT EXISTS idx_universal_candidacies_candidate

  ON universal_candidacies (candidate_entity_id);

CREATE INDEX IF NOT EXISTS idx_universal_candidacies_scope

  ON universal_candidacies (cycle, state, office_level, office_name, district);

 

CREATE TABLE IF NOT EXISTS universal_candidate_providers (

  id BIGSERIAL PRIMARY KEY,

  provider_key TEXT NOT NULL UNIQUE,

  provider_name TEXT NOT NULL,

  provider_type TEXT NOT NULL,

  jurisdiction_level TEXT NOT NULL DEFAULT 'all',

  state TEXT,

  enabled BOOLEAN NOT NULL DEFAULT TRUE,

  priority INTEGER NOT NULL DEFAULT 50,

  base_url TEXT,

  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,

  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,

  freshness_minutes INTEGER NOT NULL DEFAULT 1440,

  last_success_at TIMESTAMPTZ,

  last_failure_at TIMESTAMPTZ,

  last_error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

);

 

CREATE TABLE IF NOT EXISTS universal_candidate_evidence (

  id BIGSERIAL PRIMARY KEY,

  candidate_entity_id BIGINT REFERENCES universal_candidate_entities(id) ON DELETE CASCADE,

  candidacy_id BIGINT REFERENCES universal_candidacies(id) ON DELETE SET NULL,

  provider_key TEXT NOT NULL,

  evidence_type TEXT NOT NULL,

  title TEXT,

  summary TEXT,

  source_name TEXT,

  source_url TEXT,

  source_record_id TEXT,

  published_at TIMESTAMPTZ,

  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  confidence_score NUMERIC NOT NULL DEFAULT 50,

  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  dedupe_key TEXT NOT NULL UNIQUE

);

 

CREATE INDEX IF NOT EXISTS idx_universal_candidate_evidence_candidate

  ON universal_candidate_evidence (candidate_entity_id, evidence_type, published_at DESC);

 

CREATE TABLE IF NOT EXISTS universal_candidate_refresh_runs (

  id BIGSERIAL PRIMARY KEY,

  run_key TEXT NOT NULL UNIQUE,

  candidate_entity_id BIGINT REFERENCES universal_candidate_entities(id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'running',

  requested_context JSONB NOT NULL DEFAULT '{}'::jsonb,

  provider_results JSONB NOT NULL DEFAULT '[]'::jsonb,

  evidence_count INTEGER NOT NULL DEFAULT 0,

  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  completed_at TIMESTAMPTZ

);

 

INSERT INTO universal_candidate_providers

  (provider_key, provider_name, provider_type, jurisdiction_level, priority, capabilities)

VALUES

  ('openfec', 'Federal Election Commission OpenFEC', 'official', 'federal', 100,

   '["identity","candidacy","finance"]'::jsonb),

  ('stored_candidates', 'VoterSpheres Candidate Registry', 'internal', 'all', 95,

   '["identity","candidacy","profile"]'::jsonb),

  ('unified_polling', 'VoterSpheres Unified Polling', 'internal', 'all', 85,

   '["polling"]'::jsonb),

  ('live_news', 'VoterSpheres Live Political News', 'news', 'all', 75,

   '["news","discovery","signals"]'::jsonb)

ON CONFLICT (provider_key) DO NOTHING;

 

INSERT INTO universal_candidate_entities (

  canonical_name, normalized_name, first_name, last_name, party, home_state,

  website, photo_url, biography, status, verification_status, confidence_score,

  source_updated_at

)

SELECT

  COALESCE(NULLIF(c.full_name, ''), NULLIF(c.name, ''), 'Unknown Candidate'),

  LOWER(REGEXP_REPLACE(COALESCE(NULLIF(c.full_name, ''), NULLIF(c.name, ''), ''), '[^a-zA-Z0-9]+', ' ', 'g')),

  c.first_name, c.last_name, c.party,

  UPPER(COALESCE(NULLIF(c.state_code, ''), NULLIF(c.state, ''))),

  c.website, COALESCE(c.photo_url, c.photo), c.bio,

  COALESCE(c.status, c.campaign_status, 'active'),

  CASE WHEN c.fec_candidate_id IS NOT NULL THEN 'provider_verified' ELSE 'registry' END,

  CASE WHEN c.fec_candidate_id IS NOT NULL THEN 95 ELSE 70 END,

  COALESCE(c.source_updated_at, c.updated_at, c.last_imported_at, NOW())

FROM candidates c

WHERE COALESCE(NULLIF(c.full_name, ''), NULLIF(c.name, '')) IS NOT NULL

  AND NOT EXISTS (

    SELECT 1 FROM universal_candidate_entities u

    WHERE u.normalized_name = LOWER(REGEXP_REPLACE(COALESCE(NULLIF(c.full_name, ''), NULLIF(c.name, '')), '[^a-zA-Z0-9]+', ' ', 'g'))

      AND COALESCE(u.home_state, '') = COALESCE(UPPER(COALESCE(NULLIF(c.state_code, ''), NULLIF(c.state, ''))), '')

  );

 

INSERT INTO universal_candidate_identifiers

  (candidate_entity_id, provider, identifier_type, identifier_value, cycle, verified)

SELECT u.id, 'openfec', 'fec_candidate_id', c.fec_candidate_id, c.election_year, TRUE

FROM candidates c

JOIN universal_candidate_entities u

  ON u.normalized_name = LOWER(REGEXP_REPLACE(COALESCE(NULLIF(c.full_name, ''), NULLIF(c.name, '')), '[^a-zA-Z0-9]+', ' ', 'g'))

 AND COALESCE(u.home_state, '') = COALESCE(UPPER(COALESCE(NULLIF(c.state_code, ''), NULLIF(c.state, ''))), '')

WHERE c.fec_candidate_id IS NOT NULL

ON CONFLICT (provider, identifier_type, identifier_value) DO NOTHING;

 

CREATE OR REPLACE FUNCTION set_universal_candidate_updated_at()

RETURNS TRIGGER AS $$

BEGIN

  NEW.updated_at = NOW();

  RETURN NEW;

END;

$$ LANGUAGE plpgsql;

 

DROP TRIGGER IF EXISTS trg_universal_candidate_entities_updated_at ON universal_candidate_entities;

CREATE TRIGGER trg_universal_candidate_entities_updated_at

BEFORE UPDATE ON universal_candidate_entities

FOR EACH ROW EXECUTE FUNCTION set_universal_candidate_updated_at();

 
