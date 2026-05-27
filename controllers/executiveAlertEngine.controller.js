import { buildExecutiveAlertFeed } from "../services/executiveAlertEngine.service.js";

export async function getExecutiveAlerts(req, res) {
  try {
    const result = await buildExecutiveAlertFeed(req.query || {});
    return res.json(result);
  } catch (error) {
    console.error("Executive Alert Engine error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to build executive alerts",
    });
  }
}
