import dotenv from "dotenv";
import { loadGeoJsonFromFile, normalizeFeatureCollection } from "../providers/map.provider.js";
import {
  ensureMapRegionsConstraints,
  upsertMapRegion
} from "../repositories/map.repository.js";

dotenv.config();

const DEFAULT_MAP_FILE =
  process.env.MAP_STATES_GEOJSON_PATH || "./data/us-states.geojson";

export async function runMapIngestion({
  filePath = DEFAULT_MAP_FILE,
  regionType = "state"
} = {}) {
  await ensureMapRegionsConstraints();

  const featureCollection = await loadGeoJsonFromFile(filePath);
  const normalized = normalizeFeatureCollection(featureCollection, regionType);

  const inserted = [];

  for (const row of normalized) {
    const saved = await upsertMapRegion(row);
    inserted.push(saved);
  }

  return {
    ok: true,
    filePath,
    regionType,
    inserted: inserted.length
  };
}
