import express from "express";
import {
  getPlatformIntelligence,
  getPlatformIntelligenceActions,
  getPlatformIntelligenceEntity,
} from "../services/platformIntelligence.service.js";

const router = express.Router();

router.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    service: "platform-intelligence",
    status: "ready",
  });
});

router.get("/", async (req, res) => {
  try {
    const result = await getPlatformIntelligence(req.query || {});
    res.json(result);
  } catch (error) {
    console.error("Platform intelligence error:", error);

    res.status(500).json({
      ok: false,
      error:
        error.message ||
        "Failed to load platform intelligence graph",
    });
  }
});

router.get("/entity", async (req, res) => {
  try {
    const result = await getPlatformIntelligenceEntity(req.query || {});
    res.json(result);
  } catch (error) {
    console.error("Platform intelligence entity error:", error);

    res.status(500).json({
      ok: false,
      error:
        error.message ||
        "Failed to load related platform intelligence",
    });
  }
});

router.get("/actions", async (req, res) => {
  try {
    const result = await getPlatformIntelligenceActions(req.query || {});
    res.json(result);
  } catch (error) {
    console.error("Platform intelligence actions error:", error);

    res.status(500).json({
      ok: false,
      error:
        error.message ||
        "Failed to load platform intelligence actions",
    });
  }
});

export default router;
