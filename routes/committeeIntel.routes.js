import express from "express";
import {
  committeeIntelController,
  committeeProfileController,
} from "../controllers/committeeIntel.controller.js";

const router = express.Router();

router.get("/intel", committeeIntelController);
router.get("/:id", committeeProfileController);

export default router;
