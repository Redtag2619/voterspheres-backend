import express from "express";
import {
  getVendors,
  getVendorStates
} from "../services/vendors.service.js";

const router = express.Router();

router.get("/", getVendors);
router.get("/dropdowns/states", getVendorStates);

export default router;
