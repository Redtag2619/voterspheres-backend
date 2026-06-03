import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  getTaskOwnershipDashboard,
  listTaskOwners,
  updateTaskOwnership,
} from "../services/taskOwnership.service.js";

const router = express.Router();

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const data = await getTaskOwnershipDashboard({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("[task-ownership] dashboard failed", error);
    return res.status(500).json({
      error: "Failed to load task ownership dashboard.",
      detail: error.message,
    });
  }
});

router.get("/owners", requireAuth, async (req, res) => {
  try {
    const owners = await listTaskOwners({
      user: req.user || req.auth || {},
    });

    return res.json({ ok: true, owners });
  } catch (error) {
    console.error("[task-ownership] owners failed", error);
    return res.status(500).json({
      error: "Failed to load task owners.",
      detail: error.message,
    });
  }
});

router.put("/tasks/:taskId", requireAuth, async (req, res) => {
  try {
    const task = await updateTaskOwnership({
      user: req.user || req.auth || {},
      taskId: req.params.taskId,
      payload: req.body || {},
    });

    return res.json({ ok: true, task });
  } catch (error) {
    console.error("[task-ownership] update failed", error);
    return res.status(500).json({
      error: "Failed to update task ownership.",
      detail: error.message,
    });
  }
});

export default router;
