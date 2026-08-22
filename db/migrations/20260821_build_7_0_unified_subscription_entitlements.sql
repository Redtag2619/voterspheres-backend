BEGIN;

ALTER TABLE firms
  ALTER COLUMN plan_tier SET DEFAULT 'free';

ALTER TABLE firms
  ADD COLUMN IF NOT EXISTS subscription_status TEXT,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;

CREATE TABLE IF NOT EXISTS firm_entitlement_overrides (
  id BIGSERIAL PRIMARY KEY,
  firm_id BIGINT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  entitlement_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  limit_override BIGINT,
  reason TEXT,
  expires_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, entitlement_key)
);

CREATE INDEX IF NOT EXISTS idx_firm_entitlement_overrides_active
  ON firm_entitlement_overrides (firm_id, entitlement_key, expires_at);

CREATE TABLE IF NOT EXISTS subscription_usage (
  id BIGSERIAL PRIMARY KEY,
  firm_id BIGINT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  period_start DATE NOT NULL,
  used BIGINT NOT NULL DEFAULT 0 CHECK (used >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firm_id, metric_key, period_start)
);

CREATE INDEX IF NOT EXISTS idx_subscription_usage_firm_period
  ON subscription_usage (firm_id, period_start DESC);

COMMIT;
