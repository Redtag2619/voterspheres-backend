import express from "express";
import {
  addWorkspaceMemberController,
  addWorkspaceTargetController,
  createCampaignWorkspaceController,
  getCampaignWorkspaceController,
  listCampaignWorkspacesController,
  updateCampaignWorkspaceController,
} from "../controllers/campaignWorkspaces.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/", requireAuth, listCampaignWorkspacesController);
router.post("/", requireAuth, createCampaignWorkspaceController);
router.get("/:id", requireAuth, getCampaignWorkspaceController);
router.put("/:id", requireAuth, updateCampaignWorkspaceController);

router.post("/:id/members", requireAuth, addWorkspaceMemberController);
router.post("/:id/targets", requireAuth, addWorkspaceTargetController);

export default router;
