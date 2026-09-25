CREATE TABLE IF NOT EXISTS election_cycles (
  cycle_year INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'future',
  is_selectable BOOLEAN NOT NULL DEFAULT TRUE,
  starts_on DATE,
  ends_on DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT election_cycles_even_year CHECK (cycle_year >= 2026 AND cycle_year <= 2200 AND MOD(cycle_year, 2) = 0),
  CONSTRAINT election_cycles_status CHECK (status IN ('historical', 'current', 'planning', 'future', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_election_cycles_single_current
  ON election_cycles (status)
  WHERE status = 'current';

CREATE INDEX IF NOT EXISTS idx_election_cycles_selectable_year
  ON election_cycles (is_selectable, cycle_year);

INSERT INTO election_cycles (cycle_year, label, status, is_selectable)
VALUES
  (2026, '2026 Federal Election Cycle', 'current', TRUE),
  (2028, '2028 Federal Election Cycle', 'planning', TRUE),
  (2030, '2030 Federal Election Cycle', 'future', TRUE),
  (2032, '2032 Federal Election Cycle', 'future', TRUE),
  (2034, '2034 Federal Election Cycle', 'future', TRUE),
  (2036, '2036 Federal Election Cycle', 'future', TRUE),
  (2038, '2038 Federal Election Cycle', 'future', TRUE),
  (2040, '2040 Federal Election Cycle', 'future', TRUE)
ON CONFLICT (cycle_year) DO UPDATE
SET
  label = EXCLUDED.label,
  is_selectable = EXCLUDED.is_selectable,
  updated_at = NOW();

COMMENT ON TABLE election_cycles IS 'Authoritative registry for selectable even-numbered federal election cycles.';
