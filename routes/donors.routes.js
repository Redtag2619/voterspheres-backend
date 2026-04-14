import express from "express";
import { getDonorNetwork } from "../controllers/donors.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

/**
 * Public testing route for local/dev map workflows
 * Example:
 *   GET /api/donors/network/public?candidate_id=H0GA00000&limit=10
 */
router.get("/network/public", getDonorNetwork);

/**
 * Protected production route
 * Example:
 *   GET /api/donors/network?candidate_id=H0GA00000&limit=10
 */
router.get("/network", requireAuth, getDonorNetwork);

export default router;
