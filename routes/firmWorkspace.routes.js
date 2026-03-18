import express from "express";
import { getFirmWorkspace } from "../services/firmWorkspace.service.js";

const router = express.Router();

router.get("/:id/workspace", getFirmWorkspace);

export default router;
