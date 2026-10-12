import 'dotenv/config';
import {pool} from '../db/pool.js';
const client=await pool.connect();
try{
 await client.query('BEGIN READ ONLY');
 const report=await client.query(`WITH keyed AS (
 SELECT source,cycle,committee_id,transaction_id,COUNT(*) AS rows,
 COUNT(DISTINCT (to_jsonb(v)-'id'-'created_at'-'updated_at'-'source_updated_at')::text) AS variants
 FROM vendor_fec_spend v WHERE NULLIF(BTRIM(transaction_id),'') IS NOT NULL
 GROUP BY source,cycle,committee_id,transaction_id)
 SELECT (SELECT COUNT(*) FROM vendor_fec_spend) AS vendor_rows,
 COUNT(*) FILTER (WHERE rows>1) AS repeated_key_groups,
 COUNT(*) FILTER (WHERE rows>1 AND variants=1) AS identical_value_groups,
 COUNT(*) FILTER (WHERE rows>1 AND variants>1) AS conflicting_value_groups,
 COALESCE(SUM(rows-1) FILTER (WHERE rows>1),0) AS extra_keyed_rows,
 (SELECT COUNT(*) FROM vendor_fec_spend WHERE NULLIF(BTRIM(committee_id),'') IS NULL) AS missing_committee FROM keyed`);
 console.log(JSON.stringify({checked_at:new Date().toISOString(),report:report.rows[0],policy:'Read only. Matching keys are not proof of interchangeable amendments. No records selected for removal.'},null,2));
}finally{await client.query('ROLLBACK');client.release();await pool.end();}
