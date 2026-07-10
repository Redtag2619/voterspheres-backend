import { pool } from "../../db/pool.js";

export async function ensureAiCampaignCopilotTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_campaign_copilot_threads (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      workspace_id INTEGER NULL,
      title TEXT DEFAULT 'Campaign Co-Pilot Conversation',
      created_by INTEGER NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_campaign_copilot_messages (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      thread_id INTEGER NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      context_snapshot JSONB DEFAULT '{}'::jsonb,
      created_by INTEGER NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE ai_campaign_copilot_messages
      ADD COLUMN IF NOT EXISTS answer_type TEXT DEFAULT 'platform_intelligence',
      ADD COLUMN IF NOT EXISTS sources JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS confidence INTEGER DEFAULT 88,
      ADD COLUMN IF NOT EXISTS agent_key TEXT DEFAULT 'executive_chief_of_staff',
      ADD COLUMN IF NOT EXISTS agent_label TEXT DEFAULT 'Executive Chief of Staff';
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_campaign_copilot_threads_firm
    ON ai_campaign_copilot_threads (firm_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_ai_campaign_copilot_messages_firm_thread
    ON ai_campaign_copilot_messages (firm_id, thread_id, created_at ASC);
  `);
}
