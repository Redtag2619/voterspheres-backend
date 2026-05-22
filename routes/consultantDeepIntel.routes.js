import express from "express";
import { consultantDeepProfileController } from "../controllers/consultantDeepIntel.controller.js";

const router = express.Router();

router.get("/profile/:id", consultantDeepProfileController);

export default router;
