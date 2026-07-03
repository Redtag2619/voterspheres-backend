import express from "express";
import {
  getNationalPoliticalDigitalTwin,
  seedNationalPoliticalDigitalTwin,
  getNationalPoliticalDigitalTwinHealth,
} from "../controllers/nationalDigitalTwin.controller.js";

const router = express.Router();

router.get("/health", getNationalPoliticalDigitalTwinHealth);
router.get("/", getNationalPoliticalDigitalTwin);
router.post("/seed", seedNationalPoliticalDigitalTwin);

export default router;
