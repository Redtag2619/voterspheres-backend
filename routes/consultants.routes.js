import express from "express";
import {
  getConsultants,
  getConsultantStates,
} from "../controllers/consultants.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/", requireAuth, getConsultants);
router.get("/states", requireAuth, getConsultantStates);

export default router;
