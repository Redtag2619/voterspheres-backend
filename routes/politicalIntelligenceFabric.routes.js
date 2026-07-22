import { Router } from "express";

import { requireAuth } from "../middleware/auth.middleware.js";

import {

  getPoliticalFabricHealth,

  getPoliticalFabricOverviewController,

  runPoliticalScanController,

  createPoliticalBriefController,

  listPoliticalBriefsController,

  getPoliticalBriefController,

  listWatchlistController,

  upsertWatchlistController,

  deleteWatchlistController,

  runPoliticalScenarioController

} from "../controllers/politicalIntelligenceFabric.controller.js";

 

const router = Router();

 

router.get("/health", requireAuth, getPoliticalFabricHealth);

router.get("/overview", requireAuth, getPoliticalFabricOverviewController);

router.post("/scan", requireAuth, runPoliticalScanController);

 

router.get("/briefs", requireAuth, listPoliticalBriefsController);

router.get("/briefs/:id", requireAuth, getPoliticalBriefController);

router.post("/briefs", requireAuth, createPoliticalBriefController);

 

router.get("/watchlist", requireAuth, listWatchlistController);

router.post("/watchlist", requireAuth, upsertWatchlistController);

router.delete("/watchlist/:id", requireAuth, deleteWatchlistController);

 

router.post("/scenarios", requireAuth, runPoliticalScenarioController);

 

export default router;

