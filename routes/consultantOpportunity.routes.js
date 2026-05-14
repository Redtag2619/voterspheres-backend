import express from "express";
import {
  scoreConsultantOpportunities,
  listConsultantOpportunities,
  getConsultantOpportunitySummary,
  getConsultantOpportunityDetail,
  getCampaignOpportunityHeatmap,
} from "../services/consultantOpportunity.service.js";

const router = express.Router();

function numericId(value) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : null;
}

router.get("/", async (req, res) => {
  try {
    const data = await listConsultantOpportunities(req.query || {});
    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("Consultant opportunity list error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load consultant opportunities",
    });
  }
});

router.get("/summary", async (req, res) => {
  try {
    const summary = await getConsultantOpportunitySummary(req.query || {});
    return res.json({ ok: true, summary });
  } catch (error) {
    console.error("Consultant opportunity summary error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load consultant opportunity summary",
    });
  }
});

router.get("/heatmap", async (req, res) => {
  try {
    const data = await getCampaignOpportunityHeatmap(req.query || {});
    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("Campaign opportunity heatmap error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load campaign opportunity heatmap",
    });
  }
});

router.post("/score", async (req, res) => {
  try {
    const results = await scoreConsultantOpportunities(req.body || {});
    return res.json({
      ok: true,
      scored: results.length,
      results,
    });
  } catch (error) {
    console.error("Consultant opportunity scoring error:", error);
    return res.status(500).json({
      error: error.message || "Failed to score consultant opportunities",
    });
  }
});

router.get("/:candidateId", async (req, res) => {
  try {
    const candidateId = numericId(req.params.candidateId);

    if (!candidateId) {
      return res.status(400).json({ error: "Invalid candidate id" });
    }

    const result = await getConsultantOpportunityDetail(candidateId);

    if (!result) {
      return res.status(404).json({ error: "Consultant opportunity not found" });
    }

    return res.json({
      ok: true,
      result,
      opportunity: result,
    });
  } catch (error) {
    console.error("Consultant opportunity detail error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load consultant opportunity",
    });
  }
});

export default router;
