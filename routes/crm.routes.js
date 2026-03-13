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

const router = express.Router();

router.post("/init", initializeCrm);

router.get("/firms", listFirmsHandler);
router.post("/firms", createFirmHandler);

router.get("/users", listUsersHandler);
router.post("/users", createUserHandler);

router.get("/campaigns", listCampaignsHandler);
router.post("/campaigns", createCampaignHandler);
router.get("/campaigns/:id", getCampaignWorkspaceHandler);

router.post("/campaigns/:id/contacts", addCampaignContactHandler);
router.post("/campaigns/:id/vendors", addCampaignVendorHandler);
router.post("/campaigns/:id/tasks", addCampaignTaskHandler);
router.post("/campaigns/:id/documents", addCampaignDocumentHandler);

export default router;
