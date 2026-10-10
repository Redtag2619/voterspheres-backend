import 'dotenv/config';
import pool from '../config/database.js';
export const statements=[
 'DROP INDEX IF EXISTS public.idx_candidates_fec_candidate_id',
 'CREATE UNIQUE INDEX idx_candidates_fec_candidate_id ON public.candidates(fec_candidate_id,election_year) WHERE fec_candidate_id IS NOT NULL',
 'ALTER TABLE public.fundraising_live DROP CONSTRAINT fundraising_live_pkey',
 'ALTER TABLE public.fundraising_live ADD CONSTRAINT fundraising_live_pkey PRIMARY KEY(candidate_id,election_year)'
];
let client;
try {
 if(!process.argv.includes('--apply')) console.log(JSON.stringify({mode:'preview',statements,policy:'Existing candidate IDs, profile references, slugs and rows are preserved. Pause all FEC writers before migration and deploy.'},null,2));
 else {
  client=await pool.connect();await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='10s'");await client.query("SET LOCAL statement_timeout='60s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('voterspheres:fec-sync',0))");
  const marker=await client.query("SELECT to_regclass('public.cycle_import_storage_version') AS name");
  if(!marker.rows[0]?.name){
   for(const sql of statements)await client.query(sql);
   await client.query('CREATE TABLE public.cycle_import_storage_version(version INTEGER PRIMARY KEY, installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
   await client.query('INSERT INTO public.cycle_import_storage_version(version) VALUES(1)');
  }
  await client.query('COMMIT');console.log('Cycle import storage installed; existing records and candidate IDs preserved.');
 }
} catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({ok:false,code:error.code||'MIGRATION_FAILED'}));process.exitCode=1;}
finally{client?.release();await pool.end();}
