import express from "express";

import {
  darkMoneyExposureController,
  darkMoneyExposureProfileController,
} from "../controllers/darkMoneyExposure.controller.js";

const router = express.Router();

router.get("/", darkMoneyExposureController);

router.get(
  "/profile/:id",
  darkMoneyExposureProfileController
);

export default router;
