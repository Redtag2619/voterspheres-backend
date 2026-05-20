import express from "express";
import {
  scoreConsultantRiskController,
  consultantRiskDashboardController,
  consultantProfileController,
} from "../controllers/consultantRisk.controller.js";

const router = express.Router();

router.get("/dashboard", consultantRiskDashboardController);
router.post("/score", scoreConsultantRiskController);
router.get("/profile/:id", consultantProfileController);

export default router;
