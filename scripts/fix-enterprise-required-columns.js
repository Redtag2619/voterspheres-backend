import { pool } from "../db/pool.js";

await pool.query(`
  ALTER TABLE enterprise_leads
    ALTER COLUMN team_size DROP NOT NULL,
    ALTER COLUMN full_name DROP NOT NULL
`);

await pool.query(`
  UPDATE enterprise_leads
  SET team_size = COALESCE(team_size, 1)
`);

console.log("enterprise_leads constraints fixed");
await pool.end();
