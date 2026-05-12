import "dotenv/config";
import pool from "../config/database.js";

async function run() {
  console.log("Fixing candidate_profiles columns...");

  await pool.query(`
    ALTER TABLE candidate_profiles
      ADD COLUMN IF NOT EXISTS facebook_url TEXT,
      ADD COLUMN IF NOT EXISTS x_url TEXT,
      ADD COLUMN IF NOT EXISTS instagram_url TEXT,
      ADD COLUMN IF NOT EXISTS youtube_url TEXT,
      ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
      ADD COLUMN IF NOT EXISTS tiktok_url TEXT,
      ADD COLUMN IF NOT EXISTS contact_source_url TEXT,
      ADD COLUMN IF NOT EXISTS source_label TEXT DEFAULT 'campaign_site_live',
      ADD COLUMN IF NOT EXISTS admin_locked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS locked_fields JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS contact_confidence NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS scraped_pages JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS verified_by TEXT,
      ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS internal_notes TEXT,
      ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMP
  `);

  console.log("candidate_profiles columns fixed.");

  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
