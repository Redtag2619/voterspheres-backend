import {
  getVendorPerformanceDashboard
} from "../services/vendorPerformance.service.js";

export async function getVendorPerformance(req, res) {
  try {
    const data = await getVendorPerformanceDashboard(req.query || {});
    res.json(data);
  } catch (err) {
    console.error("getVendorPerformance error:", err.message);

    res.status(500).json({
      error: err.message || "Failed vendor performance"
    });
  }
}
