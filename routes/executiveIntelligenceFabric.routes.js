import { Router } from "express";

import { requireAuth } from "../middleware/auth.middleware.js";

import { getFabricHealth, planFabricRequest, createFabricBrief, simulateFabricScenario } from "../controllers/executiveIntelligenceFabric.controller.js";

const router=Router();

router.get("/health",requireAuth,getFabricHealth);

router.post("/plan",requireAuth,planFabricRequest);

router.post("/brief",requireAuth,createFabricBrief);

router.post("/simulate",requireAuth,simulateFabricScenario);

export default router;
