import {
  getConsultantContactEnrichmentStatus,
  getConsultantsNeedingContactEnrichment,
  enrichConsultantContactsBatch,
  enrichConsultantContact,
} from "../services/consultantContactEnrichment.service.js";

export async function consultantContactStatusController(req, res) {
  try {
    const result = await getConsultantContactEnrichmentStatus(req.query || {});
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
    console.error("Consultants needing enrichment error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load consultants needing enrichment",
    });
  }
}

export async function enrichConsultantContactsBatchController(req, res) {
  try {
    const result = await enrichConsultantContactsBatch({
      ...(req.query || {}),
      ...(req.body || {}),
    });

    return res.json(result);
  } catch (error) {
    console.error("Consultant batch enrichment error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to enrich consultant contacts",
    });
  }
}

export async function enrichSingleConsultantContactController(req, res) {
  try {
    const consultantId = Number(req.params.id);

    if (!Number.isFinite(consultantId) || consultantId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Invalid consultant id",
      });
    }

    const result = await enrichConsultantContact(consultantId, {
      ...(req.query || {}),
      ...(req.body || {}),
    });

    return res.json(result);
  } catch (error) {
    console.error("Single consultant enrichment error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to enrich consultant contact",
    });
  }
}

export async function consultantContactHistoryController(req, res) {
  try {
    const consultantId = Number(req.params.id);

    if (!Number.isFinite(consultantId) || consultantId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Invalid consultant id",
      });
    }

    return res.json({ ok: true, consultant_id: consultantId, results: [] });
  } catch (error) {
    console.error("Consultant contact history error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load consultant contact history",
    });
  }
}



