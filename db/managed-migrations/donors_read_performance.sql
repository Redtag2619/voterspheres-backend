CREATE OR REPLACE VIEW donors_read AS
WITH committee_cycles AS MATERIALIZED (
  SELECT DISTINCT s.cycle, d.committee_id
  FROM money_donor_snapshots d
  JOIN money_import_scans s ON s.id = d.scan_id
),
winners AS MATERIALIZED (
  SELECT cycle, committee_id,
         money_published_scan('donors', cycle, committee_id) AS scan_id
  FROM committee_cycles
)
SELECT d.*
FROM donors d
WHERE d.source IS DISTINCT FROM 'fec_schedule_a'
   OR NOT EXISTS (
     SELECT 1 FROM money_import_checkpoints c
     WHERE c.lane = 'donors'
       AND c.cycle = d.cycle
       AND c.published_scan_id IS NOT NULL
   )
UNION ALL
SELECT donor.*
FROM winners w
JOIN money_donor_snapshots d
  ON d.scan_id = w.scan_id AND d.committee_id = w.committee_id
JOIN money_import_checkpoints c ON c.published_scan_id = d.scan_id
CROSS JOIN LATERAL jsonb_populate_record(
  NULL::donors,
  d.payload || jsonb_build_object(
    'id', -d.row_id,
    'amount', d.amount,
    'contribution_count', d.contributions,
    'source_updated_at', c.published_at,
    'updated_at', c.published_at
  )
) AS donor;