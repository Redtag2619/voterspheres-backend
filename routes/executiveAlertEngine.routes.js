import express from "express";
import { getExecutiveAlerts } from "../controllers/executiveAlertEngine.controller.js";

const router = express.Router();

router.get("/", getExecutiveAlerts);

export default router;
