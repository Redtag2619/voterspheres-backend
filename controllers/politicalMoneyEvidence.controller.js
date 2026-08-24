
import {
  getPoliticalMoneyEvidenceProfile,
  getPoliticalMoneyProviderHealth,
  importReviewedPoliticalMoneyEvidence,
  rebuildPoliticalMoneyScores,
  syncFecIndependentExpenditures,
} from "../services/politicalMoneyEvidence.service.js";

function isPlatformAdmin(req) {
  const role = String(req.user?.role || req.auth?.role || "").toLowerCase();
  return ["admin", "platform_admin", "super_admin", "owner"].includes(role);
}

function denyUnlessAdmin(req, res) {
  if (isPlatformAdmin(req)) return false;
  res.status(403).json({ ok: false, error: "Platform administrator access required." });
  return true;
}

export async function politicalMoneyProviderHealthController(_req, res) {
  try {
    return res.json(await getPoliticalMoneyProviderHealth());
  } catch (error) {
    console.error("Political money provider health error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Unable to load provider health." });
  }
}

export async function politicalMoneyEvidenceProfileController(req, res) {
  try {
    const result = await getPoliticalMoneyEvidenceProfile(req.params.id, req.query || {});
    if (!result) return res.status(404).json({ ok: false, error: "Political money organization not found." });
    return res.json(result);
  } catch (error) {
    console.error("Political money evidence profile error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Unable to load evidence profile." });
  }
}

export async function syncFecPoliticalMoneyController(req, res) {
  if (denyUnlessAdmin(req, res)) return;
  try {
    const result = await syncFecIndependentExpenditures({ ...(req.query || {}), ...(req.body || {}) });
    return res.json({ ok: true, message: "FEC political-money synchronization completed.", run: result });
  } catch (error) {
    console.error("FEC political money sync error:", error);
    return res.status(500).json({ ok: false, error: error.message || "FEC political-money synchronization failed." });
  }
}

export async function importPoliticalMoneyEvidenceController(req, res) {
  if (denyUnlessAdmin(req, res)) return;
  try {
    const records = Array.isArray(req.body) ? req.body : req.body?.records;
    const result = await importReviewedPoliticalMoneyEvidence(records || [], {
      userId: req.user?.id || null,
      cycle: req.body?.cycle || req.query?.cycle,
    });
    return res.status(result.ok ? 200 : 207).json(result);
  } catch (error) {
    console.error("Political money evidence import error:", error);
    return res.status(400).json({ ok: false, error: error.message || "Evidence import failed." });
  }
}

export async function rebuildPoliticalMoneyScoresController(req, res) {
  if (denyUnlessAdmin(req, res)) return;
  try {
    return res.json(await rebuildPoliticalMoneyScores({ ...(req.query || {}), ...(req.body || {}) }));
  } catch (error) {
    console.error("Political money score rebuild error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Score rebuild failed." });
  }
}
