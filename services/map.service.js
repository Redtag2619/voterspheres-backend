import {
  getMapRegionsByType,
  getMapRegionByName
} from "../repositories/map.repository.js";
import { runMapIngestion } from "../jobs/mapIngestion.job.js";

function toFeatureCollection(rows = []) {
  return {
    type: "FeatureCollection",
    features: rows.map((row) => row.geojson)
  };
}

export async function getStatesGeoJson(_req, res, next) {
  try {
    const rows = await getMapRegionsByType("state");
    res.json(toFeatureCollection(rows));
  } catch (err) {
    next(err);
  }
}

export async function getStateGeoJson(req, res, next) {
  try {
    const stateName = String(req.params.stateName || "");
    const row = await getMapRegionByName("state", stateName);

    if (!row) {
      return res.status(404).json({
        error: `Map region not found: ${stateName}`
      });
    }

    res.json(row.geojson);
  } catch (err) {
    next(err);
  }
}

export async function runManualMapIngestion(req, res, next) {
  try {
    const filePath = String(
      req.body?.filePath ||
        process.env.MAP_STATES_GEOJSON_PATH ||
        "./data/us-states.geojson"
    );

    const result = await runMapIngestion({
      filePath,
      regionType: "state"
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}
