import express from "express";
import { getDonorNetwork } from "../controllers/donors.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/network", requireAuth, getDonorNetwork);

export default router;
