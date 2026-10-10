import 'dotenv/config';
import {pool} from '../db/pool.js';
const statements = [
  'ALTER TABLE public.donors ADD COLUMN IF NOT EXISTS cycle INTEGER',
  'CREATE INDEX IF NOT EXISTS idx_donors_cycle ON public.donors(cycle)',
  `INSERT INTO public.election_cycles(cycle_year,label,status,is_selectable,starts_on,ends_on)
   SELECT year, year::text, 'future', TRUE, make_date(year-1,1,1), make_date(year,12,31)
   FROM generate_series(2028,2040,2) AS year
   ON CONFLICT(cycle_year) DO NOTHING`
];
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({mode:'preview',statements,policy:'Existing donor records are not relabeled. Existing registry entries are not changed.'},null,2));
} else {
  let client;
  try {
    client=await pool.connect(); await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SET LOCAL statement_timeout='60s'");
    for (const sql of statements) await client.query(sql);
    await client.query('COMMIT');
    console.log('Future-cycle support installed. Legacy donor cycles remain unassigned.');
  } catch(error) {
    if(client) await client.query('ROLLBACK').catch(()=>{});
    console.error(JSON.stringify({ok:false,code:error.code||'MIGRATION_FAILED'}));process.exitCode=1;
  } finally {client?.release();await pool.end();}
}
