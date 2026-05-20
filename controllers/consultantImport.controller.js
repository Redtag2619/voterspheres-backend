import {
  importDemoConsultants,
} from "../services/consultantImport.service.js";

export async function runConsultantImport(req, res) {
  try {
    const result = await importDemoConsultants();

    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Consultant import error:", error);

    return res.status(500).json({
      error: error.message || "Failed to import consultants",
    });
  }
}
