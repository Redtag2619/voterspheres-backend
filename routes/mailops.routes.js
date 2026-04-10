import express from "express";
import {
  getDashboard,
  createEvent,
  updateEvent,
} from "../controllers/mailops.controller.js";
import authenticateToken from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/dashboard", authenticateToken, getDashboard);
router.post("/events", authenticateToken, createEvent);
router.put("/events/:id", authenticateToken, updateEvent);

export default router;
