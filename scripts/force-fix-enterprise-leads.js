import { pool } from "../db/pool.js";

await pool.query(`
  ALTER TABLE enterprise_leads
    ADD COLUMN IF NOT EXISTS full_name TEXT,
    ADD COLUMN IF NOT EXISTS contact_name TEXT,
    ADD COLUMN IF NOT EXISTS firm_name TEXT,
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS states TEXT[],
    ADD COLUMN IF NOT EXISTS budget_range TEXT,
    ADD COLUMN IF NOT EXISTS use_case TEXT,
    ADD COLUMN IF NOT EXISTS message TEXT,
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'new',
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new',
    ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'high',
    ADD COLUMN IF NOT EXISTS team_size INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'enterprise_intake',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
`);

await pool.query(`
  ALTER TABLE enterprise_leads
    ALTER COLUMN full_name DROP NOT NULL,
    ALTER COLUMN contact_name DROP NOT NULL,
    ALTER COLUMN firm_name DROP NOT NULL,
    ALTER COLUMN email DROP NOT NULL,
    ALTER COLUMN phone DROP NOT NULL,
    ALTER COLUMN message DROP NOT NULL,
    ALTER COLUMN notes DROP NOT NULL,
    ALTER COLUMN team_size DROP NOT NULL,
    ALTER COLUMN stage DROP NOT NULL,
    ALTER COLUMN status DROP NOT NULL,
    ALTER COLUMN priority DROP NOT NULL,
    ALTER COLUMN source DROP NOT NULL
`);

await pool.query(`
  UPDATE enterprise_leads
  SET
    full_name = COALESCE(full_name, contact_name, email, firm_name, 'Unknown Lead'),
    contact_name = COALESCE(contact_name, full_name, email, firm_name, 'Unknown Lead'),
    firm_name = COALESCE(firm_name, 'Enterprise Prospect'),
    message = COALESCE(message, use_case, notes, 'Enterprise intake request'),
    notes = COALESCE(notes, message, use_case, 'Enterprise intake request'),
    team_size = COALESCE(team_size, 1),
    stage = COALESCE(stage, status, 'new'),
    status = COALESCE(status, stage, 'new'),
    priority = COALESCE(priority, 'high'),
    source = COALESCE(source, 'enterprise_intake'),
    updated_at = COALESCE(updated_at, NOW())
`);

console.log("enterprise_leads schema force-fixed");
await pool.end();
