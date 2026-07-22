CREATE TABLE IF NOT EXISTS political_intelligence_briefs (

  id BIGSERIAL PRIMARY KEY,

  workspace_id BIGINT NOT NULL,

  created_by BIGINT,

  title TEXT NOT NULL,

  scope_type TEXT NOT NULL DEFAULT 'national',

  scope_value TEXT,

  time_horizon TEXT NOT NULL DEFAULT '30d',

  status TEXT NOT NULL DEFAULT 'ready',

  executive_summary TEXT NOT NULL DEFAULT '',

  findings JSONB NOT NULL DEFAULT '[]'::jsonb,

  risks JSONB NOT NULL DEFAULT '[]'::jsonb,

  opportunities JSONB NOT NULL DEFAULT '[]'::jsonb,

  recommended_actions JSONB NOT NULL DEFAULT '[]'::jsonb,

  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

);

 

CREATE INDEX IF NOT EXISTS idx_pif_briefs_workspace_created

  ON political_intelligence_briefs (workspace_id, created_at DESC);

 

CREATE INDEX IF NOT EXISTS idx_pif_briefs_scope

  ON political_intelligence_briefs (workspace_id, scope_type, scope_value);

 

CREATE TABLE IF NOT EXISTS political_intelligence_watchlist (

  id BIGSERIAL PRIMARY KEY,

  workspace_id BIGINT NOT NULL,

  created_by BIGINT,

  entity_type TEXT NOT NULL,

  entity_id TEXT,

  entity_name TEXT NOT NULL,

  state_code VARCHAR(2),

  priority TEXT NOT NULL DEFAULT 'medium',

  status TEXT NOT NULL DEFAULT 'active',

  rationale TEXT NOT NULL DEFAULT '',

  thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,

  tags JSONB NOT NULL DEFAULT '[]'::jsonb,

  last_signal_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (workspace_id, entity_type, entity_id)

);

 

CREATE INDEX IF NOT EXISTS idx_pif_watchlist_workspace

  ON political_intelligence_watchlist (workspace_id, status, priority);

 

CREATE TABLE IF NOT EXISTS political_intelligence_snapshots (

  id BIGSERIAL PRIMARY KEY,

  workspace_id BIGINT NOT NULL,

  brief_id BIGINT REFERENCES political_intelligence_briefs(id) ON DELETE SET NULL,

  scan_key TEXT NOT NULL,

  scope_type TEXT NOT NULL,

  scope_value TEXT,

  signal_count INTEGER NOT NULL DEFAULT 0,

  source_health JSONB NOT NULL DEFAULT '{}'::jsonb,

  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

);

 

CREATE INDEX IF NOT EXISTS idx_pif_snapshots_workspace_captured

  ON political_intelligence_snapshots (workspace_id, captured_at DESC);

 

CREATE TABLE IF NOT EXISTS political_intelligence_scenarios (

  id BIGSERIAL PRIMARY KEY,

  workspace_id BIGINT NOT NULL,

  created_by BIGINT,

  name TEXT NOT NULL,

  scenario_type TEXT NOT NULL DEFAULT 'custom',

  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,

  baseline JSONB NOT NULL DEFAULT '{}'::jsonb,

  projected_outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,

  risks JSONB NOT NULL DEFAULT '[]'::jsonb,

  recommended_actions JSONB NOT NULL DEFAULT '[]'::jsonb,

  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

);

 

CREATE INDEX IF NOT EXISTS idx_pif_scenarios_workspace_created

  ON political_intelligence_scenarios (workspace_id, created_at DESC);
