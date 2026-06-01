import "dotenv/config";
import { pool } from "../db/pool.js";

async function main() {
  console.log("🚀 Creating Campaign Workspace tables...");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_workspaces (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      cycle INTEGER DEFAULT 2026,
      campaign_type TEXT DEFAULT 'general',
      status TEXT DEFAULT 'active',
      home_state TEXT,
      description TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_workspace_members (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES campaign_workspaces(id) ON DELETE CASCADE,
      user_id INTEGER,
      email TEXT,
      role TEXT DEFAULT 'member',
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(workspace_id, email)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_workspace_targets (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES campaign_workspaces(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      state_code TEXT,
      county_name TEXT,
      race_name TEXT,
      candidate_name TEXT,
      priority TEXT DEFAULT 'normal',
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_campaign_workspaces_firm_id
    ON campaign_workspaces(firm_id);

    CREATE INDEX IF NOT EXISTS idx_campaign_workspace_members_workspace
    ON campaign_workspace_members(workspace_id);

    CREATE INDEX IF NOT EXISTS idx_campaign_workspace_targets_workspace
    ON campaign_workspace_targets(workspace_id);
  `);

  console.log("✅ Campaign Workspace tables ready.");
}

main()
  .catch((error) => {
    console.error("❌ Campaign Workspace setup failed:", error);
    process.exit(1);
  })
  .finally(() => pool.end());
