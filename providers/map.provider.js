import fs from "fs/promises";
import path from "path";

function readFeatureName(feature) {
  return (
    feature?.properties?.name ||
    feature?.properties?.NAME ||
    feature?.properties?.state_name ||
    feature?.properties?.STATE_NAME ||
    null
  );
}

function readFeatureCode(feature) {
  return (
    feature?.properties?.postal ||
    feature?.properties?.STUSPS ||
    feature?.properties?.state_code ||
    feature?.properties?.STATEFP ||
    null
  );
}

export async function loadGeoJsonFromFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  return JSON.parse(raw);
}

export function normalizeFeatureCollection(featureCollection, regionType = "state") {
  const features = Array.isArray(featureCollection?.features)
    ? featureCollection.features
    : [];

  return features
    .map((feature) => {
      const regionName = readFeatureName(feature);
      if (!regionName) return null;

      return {
        regionType,
        regionCode: readFeatureCode(feature),
        regionName,
        geojson: feature,
        metadata: feature.properties || {}
      };
    })
    .filter(Boolean);
}
