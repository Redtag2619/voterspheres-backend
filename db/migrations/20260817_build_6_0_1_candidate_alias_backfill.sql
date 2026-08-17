-- Build 6.0.1 - Registry aliases and candidacy backfill

INSERT INTO universal_candidate_aliases (
  candidate_entity_id,
  alias,
  normalized_alias,
  alias_type,
  source
)
SELECT
  u.id,
  TRIM(
    CONCAT_WS(
      ' ',
      SPLIT_PART(u.canonical_name, ',', 2),
      SPLIT_PART(u.canonical_name, ',', 1)
    )
  ),
  LOWER(
    REGEXP_REPLACE(
      TRIM(
        CONCAT_WS(
          ' ',
          SPLIT_PART(u.canonical_name, ',', 2),
          SPLIT_PART(u.canonical_name, ',', 1)
        )
      ),
      '[^a-zA-Z0-9]+',
      ' ',
      'g'
    )
  ),
  'reversed_fec_name',
  'universal_registry_backfill'
FROM universal_candidate_entities u
WHERE u.canonical_name LIKE '%,%'
ON CONFLICT (candidate_entity_id, normalized_alias) DO NOTHING;

INSERT INTO universal_candidacies (
  candidate_entity_id,
  office_level,
  office_name,
  state,
  district,
  cycle,
  party,
  ballot_status,
  incumbent,
  filing_status,
  source,
  source_updated_at,
  metadata
)
SELECT
  u.id,
  CASE
    WHEN LOWER(COALESCE(c.office, '')) IN (
      'house',
      'senate',
      'president',
      'presidential'
    ) THEN 'federal'
    WHEN LOWER(COALESCE(c.office, '')) LIKE '%governor%'
      OR LOWER(COALESCE(c.office, '')) LIKE '%state%'
      THEN 'state'
    WHEN LOWER(COALESCE(c.office, '')) LIKE '%county%'
      THEN 'county'
    WHEN LOWER(COALESCE(c.office, '')) LIKE '%mayor%'
      OR LOWER(COALESCE(c.office, '')) LIKE '%city%'
      OR LOWER(COALESCE(c.office, '')) LIKE '%municipal%'
      THEN 'municipal'
    WHEN LOWER(COALESCE(c.office, '')) LIKE '%judge%'
      OR LOWER(COALESCE(c.office, '')) LIKE '%court%'
      THEN 'judicial'
    ELSE 'unknown'
  END,
  COALESCE(NULLIF(c.office, ''), 'Unknown'),
  UPPER(COALESCE(NULLIF(c.state_code, ''), NULLIF(c.state, ''))),
  c.district,
  c.election_year,
  c.party,
  COALESCE(c.status, c.campaign_status),
  COALESCE(c.incumbent, FALSE),
  c.campaign_status,
  COALESCE(c.source, 'candidates_registry'),
  COALESCE(
    c.source_updated_at,
    c.updated_at,
    c.last_imported_at,
    NOW()
  ),
  JSONB_BUILD_OBJECT(
    'candidate_table_id', c.id,
    'fec_candidate_id', c.fec_candidate_id,
    'election', c.election,
    'election_type', c.election_type
  )
FROM candidates c
JOIN universal_candidate_identifiers i
  ON i.provider = 'openfec'
 AND i.identifier_type = 'fec_candidate_id'
 AND i.identifier_value = c.fec_candidate_id
JOIN universal_candidate_entities u
  ON u.id = i.candidate_entity_id
WHERE NOT EXISTS (
  SELECT 1
  FROM universal_candidacies existing
  WHERE existing.candidate_entity_id = u.id
    AND COALESCE(existing.office_name, '') =
        COALESCE(c.office, 'Unknown')
    AND COALESCE(existing.state, '') =
        COALESCE(
          UPPER(
            COALESCE(
              NULLIF(c.state_code, ''),
              NULLIF(c.state, '')
            )
          ),
          ''
        )
    AND COALESCE(existing.district, '') =
        COALESCE(c.district, '')
    AND COALESCE(existing.cycle, 0) =
        COALESCE(c.election_year, 0)
);
