export async function readMoneyImportCoverage(pool, lane, cycle) {
  const r=await pool.query(`SELECT c.scope_key,c.committees,c.published_at,c.needs_scores,
    s.status,s.pages,s.records,s.last_error,s.updated_at,s.cutoff::text,
    p.cutoff::text AS published_cutoff
    FROM money_import_checkpoints c LEFT JOIN money_import_scans s ON s.id=c.active_scan_id
    LEFT JOIN money_import_scans p ON p.id=c.published_scan_id
    WHERE c.lane=$1 AND c.cycle=$2 ORDER BY c.scope_key`,[lane,cycle]);
  return {lane,cycle,scopes:r.rows,
    scope_notice:'Only explicitly published scopes are represented. A traversal is not an immutable provider snapshot or proof of all filings.',
    donor_identity_notice:lane==='donors'?'Disclosure groups are not verified people or candidate/contact matches.':undefined};
}
