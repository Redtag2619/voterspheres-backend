import express from "express";
import {
  listVendorCategoryDropdown,
  listVendorDirectory,
  listVendorStatusDropdown
} from "../services/vendorDirectory.service.js";

const router = express.Router();

router.get("/", listVendorDirectory);
router.get("/dropdowns/categories", listVendorCategoryDropdown);
router.get("/dropdowns/statuses", listVendorStatusDropdown);

export default router;
