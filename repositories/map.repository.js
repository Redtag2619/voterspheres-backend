import { pool } from "../db/pool.js";

export async function ensureMapRegionsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS map_regions (
      id SERIAL PRIMARY KEY,
      region_type TEXT NOT NULL,
      region_code TEXT,
      region_name TEXT NOT NULL,
      geojson JSONB NOT NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

export async function ensureMapRegionsConstraints() {
  await ensureMapRegionsTable();

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'map_regions_region_type_region_name_key'
      ) THEN
        ALTER TABLE map_regions
        ADD CONSTRAINT map_regions_region_type_region_name_key
        UNIQUE (region_type, region_name);
      END IF;
    END$$;
  `);
}

export async function upsertMapRegion({
  regionType,
  regionCode = null,
  regionName,
  geojson,
  metadata = {}
}) {
  await ensureMapRegionsConstraints();

  const result = await pool.query(
    `
    INSERT INTO map_regions (
      region_type,
      region_code,
      region_name,
      geojson,
      metadata,
      updated_at
    )
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, NOW())
    ON CONFLICT (region_type, region_name)
    DO UPDATE SET
      region_code = EXCLUDED.region_code,
      geojson = EXCLUDED.geojson,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING *
    `,
    [
      regionType,
      regionCode,
      regionName,
      JSON.stringify(geojson),
      JSON.stringify(metadata)
    ]
  );

  return result.rows[0];
}

export async function getMapRegionsByType(regionType) {
  await ensureMapRegionsTable();

  const result = await pool.query(
    `
    SELECT
      id,
      region_type,
      region_code,
      region_name,
      geojson,
      metadata,
      updated_at
    FROM map_regions
    WHERE region_type = $1
    ORDER BY region_name
    `,
    [regionType]
  );

  return result.rows;
}

export async function getMapRegionByName(regionType, regionName) {
  await ensureMapRegionsTable();

  const result = await pool.query(
    `
    SELECT
      id,
      region_type,
      region_code,
      region_name,
      geojson,
      metadata,
      updated_at
    FROM map_regions
    WHERE region_type = $1
      AND region_name = $2
    LIMIT 1
    `,
    [regionType, regionName]
  );

  return result.rows[0] || null;
}
