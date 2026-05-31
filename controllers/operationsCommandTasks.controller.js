import {
  createCountyCommandTask,
  updateCountyCommandTaskStatus,
} from "../services/operationsCommandTasks.service.js";

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

export async function updateCountyCommandTaskStatusController(req, res) {
  try {
    const task = await updateCountyCommandTaskStatus({
      taskId: req.params.id,
      status: req.body?.status,
    });

    return res.json({
      ok: true,
      task,
    });
  } catch (error) {
    console.error("[operations] update county command task status failed", error);

    return res.status(500).json({
      error: "Failed to update county command task status.",
      detail: error.message,
    });
  }
}
