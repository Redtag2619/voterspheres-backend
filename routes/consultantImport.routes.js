import express from "express";
import {
  runConsultantImport,
} from "../controllers/consultantImport.controller.js";

const router = express.Router();

router.post("/run", runConsultantImport);

export default router;
