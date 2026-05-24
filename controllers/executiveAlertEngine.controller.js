import {
  buildExecutiveAlertFeed
} from "../services/executiveAlertEngine.service.js";

export async function getExecutiveAlerts(
  req,
  res
) {
  try {
    const results =
      await buildExecutiveAlertFeed({
        limit: req.query.limit,
        minAmount: req.query.minAmount
      });

    res.json(results);
  } catch (error) {
    console.error(
      "Executive Alert Engine Error:",
      error
    );

    res.status(500).json({
      error:
        error.message ||
        "Failed to build executive alerts"
    });
  }
}
