import express from "express";
import {
  getStatesGeoJson, 
  getStateGeoJson,
  runManualMapIngestion
} from "../services/map.service.js";

const router = express.Router();

router.get("/geojson/states", getStatesGeoJson);
router.get("/geojson/states/:stateName", getStateGeoJson);
router.post("/ingest", runManualMapIngestion);

export default router;
