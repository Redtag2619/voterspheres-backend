import express from "express";  
import {
  initializeCrm,
  createFirmHandler,
  listFirmsHandler,
  createUserHandler,
  listUsersHandler,
  createCampaignHandler,
  listCampaignsHandler,
  getCampaignWorkspaceHandler,
  addCampaignContactHandler,
  addCampaignVendorHandler,
  addCampaignTaskHandler,
  addCampaignDocumentHandler
} from "../services/crm.service.js";
import { requirePlatformOperator, requireFirmAdministrator } from "../middleware/authorization.middleware.js";
import { requireFirmAccessToCampaign } from "../middleware/firmAccess.middleware.js";

const router = express.Router();

router.post("/init", requirePlatformOperator, initializeCrm);

router.get("/firms", requirePlatformOperator, listFirmsHandler);
router.post("/firms", requirePlatformOperator, createFirmHandler);

router.get("/users", requireFirmAdministrator, listUsersHandler);
router.post("/users", requireFirmAdministrator, createUserHandler);

router.get("/campaigns", listCampaignsHandler);
router.post("/campaigns", createCampaignHandler);
router.get("/campaigns/:id", requireFirmAccessToCampaign, getCampaignWorkspaceHandler);

router.post("/campaigns/:id/contacts", requireFirmAccessToCampaign, addCampaignContactHandler);
router.post("/campaigns/:id/vendors", requireFirmAccessToCampaign, addCampaignVendorHandler);
router.post("/campaigns/:id/tasks", requireFirmAccessToCampaign, addCampaignTaskHandler);
router.post("/campaigns/:id/documents", requireFirmAccessToCampaign, addCampaignDocumentHandler);

export default router;

