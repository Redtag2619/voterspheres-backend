export const originalDonors = `SELECT * FROM public.donors_read WHERE cycle=$1`;
// Preserve the winner function and legacy suppression rule exactly. Historical
// snapshots are irrelevant when none of their scan IDs is currently published.
export function candidateDonors(limit = false) {
 return `WITH committee_cycles AS MATERIALIZED (
 SELECT DISTINCT s.cycle,d.committee_id FROM public.money_donor_snapshots d
 JOIN public.money_import_scans s ON s.id=d.scan_id
 WHERE EXISTS(SELECT 1 FROM public.money_import_checkpoints c WHERE c.published_scan_id=d.scan_id)
 ), winners AS MATERIALIZED (
 SELECT cycle,committee_id,public.money_published_scan('donors',cycle,committee_id) AS scan_id FROM committee_cycles
 ), selected AS MATERIALIZED (
 SELECT d.*,c.published_at FROM winners w
 JOIN public.money_donor_snapshots d ON d.scan_id=w.scan_id AND d.committee_id=w.committee_id
 JOIN public.money_import_checkpoints c ON c.published_scan_id=d.scan_id
 CROSS JOIN LATERAL jsonb_to_record(d.payload) AS p(cycle integer)
 WHERE p.cycle=$1
 ${limit ? 'ORDER BY c.published_at DESC NULLS LAST,(-d.row_id) DESC LIMIT 25' : ''}
 ), visible AS (
 SELECT d.* FROM public.donors d WHERE d.cycle=$1 AND
 (d.source IS DISTINCT FROM 'fec_schedule_a' OR NOT EXISTS(
 SELECT 1 FROM public.money_import_checkpoints c WHERE c.lane='donors' AND c.cycle=d.cycle AND c.published_scan_id IS NOT NULL))
 UNION ALL
 SELECT donor.* FROM selected d CROSS JOIN LATERAL jsonb_populate_record(NULL::public.donors,
 d.payload || jsonb_build_object('id',-d.row_id,'amount',d.amount,'contribution_count',d.contributions,
 'source_updated_at',d.published_at,'updated_at',d.published_at)) donor
 ) SELECT * FROM visible`;
}
export const ordered25 = sql => `${sql} ORDER BY source_updated_at DESC NULLS LAST,id DESC LIMIT 25`;
export function paritySql(left,right) {
 return `WITH a AS MATERIALIZED (${left}), b AS MATERIALIZED (${right})
 SELECT (SELECT COUNT(*)::text FROM a) AS original_rows,
 (SELECT COUNT(*)::text FROM b) AS candidate_rows,
 (SELECT COUNT(*)::text FROM (TABLE a EXCEPT ALL TABLE b) q) AS original_only,
 (SELECT COUNT(*)::text FROM (TABLE b EXCEPT ALL TABLE a) q) AS candidate_only`;
}
