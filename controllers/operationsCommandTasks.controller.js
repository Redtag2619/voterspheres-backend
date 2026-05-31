import { createCountyCommandTask } from "../services/operationsCommandTasks.service.js";

export async function createCountyCommandTaskController(req, res) {
  try {
    const task = await createCountyCommandTask({
      payload: req.body || {},
      user: req.user || req.auth || {},
    });

    return res.status(201).json({
      ok: true,
      task,
    });
  } catch (error) {
    console.error("[operations] create county command task failed", error);

    return res.status(500).json({
      error: "Failed to create county command task.",
      detail: error.message,
    });
  }
}
