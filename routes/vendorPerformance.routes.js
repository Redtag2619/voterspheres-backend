import express from "express";

import {
  getVendorPerformance
} from "../controllers/vendorPerformance.controller.js";

const router = express.Router();

router.get("/", getVendorPerformance);

export default router;
