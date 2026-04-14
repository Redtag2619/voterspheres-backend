import express from "express";
import { getDonorNetwork } from "../controllers/donors.controller.js";

const router = express.Router();

router.get("/network", getDonorNetwork);

export default router;
