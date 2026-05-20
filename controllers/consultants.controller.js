import {
  importConsultantsFromFec,
  getConsultantImportStatus,
  getConsultantRankings,
  getBattlegroundConsultantRankings,
  getConsultantOverlaps,
  getOppositionExposure,
  getCandidateConsultantRelationships,
} from "../services/consultantImport.service.js";

function mergeInput(req) {
  return {
    ...(req.query || {}),
    ...(req.body || {}),
  };
}

export async function runConsultantImport(req, res) {
  try {
    const result = await importConsultantsFromFec(mergeInput(req));
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error("Consultant import error:", error);
    return res.status(error?.statusCode || 500).json({
      ok: false,
      error: error.message || "Failed to import consultants from FEC",
    });
  }
}

export async function consultantImportStatus(req, res) {
  try {
    const result = await getConsultantImportStatus();
    return res.json(result);
  } catch (error) {
    console.error("Consultant import status error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Failed to load consultant import status" });
  }
}

export async function consultantRankings(req, res) {
  try {
    const result = await getConsultantRankings(req.query || {});
    return res.json(result);
  } catch (error) {
    console.error("Consultant rankings error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Failed to load consultant rankings" });
  }
}

export async function battlegroundConsultantRankings(req, res) {
  try {
    const result = await getBattlegroundConsultantRankings(req.query || {});
    return res.json(result);
  } catch (error) {
    console.error("Battleground consultant rankings error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Failed to load battleground consultant rankings" });
  }
}

export async function consultantOverlaps(req, res) {
  try {
    const result = await getConsultantOverlaps(req.query || {});
    return res.json(result);
  } catch (error) {
    console.error("Consultant overlaps error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Failed to load consultant overlaps" });
  }
}

export async function oppositionExposure(req, res) {
  try {
    const result = await getOppositionExposure(req.query || {});
    return res.json(result);
  } catch (error) {
    console.error("Opposition exposure error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Failed to load opposition exposure" });
  }
}

export async function candidateConsultantRelationships(req, res) {
  try {
    const candidateId = Number(req.params.candidateId);

    if (!Number.isFinite(candidateId) || candidateId <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid candidate id" });
    }

    const result = await getCandidateConsultantRelationships(candidateId, req.query || {});
    return res.json(result);
  } catch (error) {
    console.error("Candidate consultant relationships error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Failed to load candidate consultant relationships" });
  }
}
