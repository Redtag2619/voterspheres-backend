import express from "express";

const router = express.Router();

const fallbackGeoJson = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Georgia", postal: "GA" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-85.6, 35.0],
          [-80.8, 35.0],
          [-80.8, 30.3],
          [-85.6, 30.3],
          [-85.6, 35.0]
        ]]
      }
    },
    {
      type: "Feature",
      properties: { name: "Pennsylvania", postal: "PA" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-80.6, 42.3],
          [-74.7, 42.3],
          [-74.7, 39.7],
          [-80.6, 39.7],
          [-80.6, 42.3]
        ]]
      }
    }
  ]
};

router.get("/geojson", async (_req, res) => {
  res.status(200).json(fallbackGeoJson);
});

export default router;
