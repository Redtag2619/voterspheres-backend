import { getOperationsMap } from "../services/operationsMap.service.js";

export async function getOperationsMapController(req, res) {
  try {
    const data = await getOperationsMap(req.query || {});
    res.json(data);
  } catch (error) {
    console.error("Operations map error:", error);

    res.status(500).json({
      ok: false,
      error: error.message || "Failed to load operations map",
    });
  }
}
