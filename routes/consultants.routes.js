import express from "express";
import {
  getConsultants,
  getConsultantStates
} from "../services/consultants.service.js";

const router = express.Router();

router.get("/", getConsultants);
router.get("/dropdowns/states", getConsultantStates);

export default router;
