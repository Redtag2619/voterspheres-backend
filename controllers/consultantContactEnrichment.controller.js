import {
  getConsultantContactEnrichmentStatus,
  getConsultantsNeedingContactEnrichment,
  enrichConsultantContact,
  enrichConsultantContactsBatch,
  getConsultantContactHistory,
} from "../services/consultantContactEnrichment.service.js";

function mergeInput(req) {
  return {
    ...(req.query || {}),
    ...(req.body || {}),
  };
}

export async function consultantContactStatusController(_req, res) {
  try {
    const result = await getConsultantContactEnrichmentStatus();
    return res.json(result);
  } catch (error) {
    console.error("Consultant contact status error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load consultant contact enrichment status",
    });
  }
}

export async function consultantsNeedingContactEnrichmentController(req, res) {
  try {
    const result = await getConsultantsNeedingContactEnrichment(req.query || {});
    return res.json(result);
  } catch (error) {
    console.error("Consultants needing contact enrichment error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load consultants needing contact enrichment",
    });
  }
}

export async function enrichSingleConsultantContactController(req, res) {
  try {
    const consultantId = Number(req.params.id);
    const result = await enrichConsultantContact(consultantId, req.body || {}, {
      dryRun: String(req.query?.dryRun || "false").toLowerCase() === "true",
    });

    if (!result) {
      return res.status(404).json({ ok: false, error: "Consultant not found" });
    }

    return res.json(result);
  } catch (error) {
    console.error("Single consultant contact enrichment error:", error);
    return res.status(error?.statusCode || 500).json({
      ok: false,
      error: error.message || "Failed to enrich consultant contact",
    });
  }
}

export async function enrichConsultantContactsBatchController(req, res) {
  try {
    const result = await enrichConsultantContactsBatch(mergeInput(req));
    return res.json(result);
  } catch (error) {
    console.error("Batch consultant contact enrichment error:", error);
    return res.status(error?.statusCode || 500).json({
      ok: false,
      error: error.message || "Failed to run consultant contact enrichment batch",
    });
  }
}

export async function consultantContactHistoryController(req, res) {
  try {
    const consultantId = Number(req.params.id);
    const result = await getConsultantContactHistory(consultantId);
    return res.json(result);
  } catch (error) {
    console.error("Consultant contact history error:", error);
    return res.status(error?.statusCode || 500).json({
      ok: false,
      error: error.message || "Failed to load consultant contact enrichment history",
    });
  }
}
