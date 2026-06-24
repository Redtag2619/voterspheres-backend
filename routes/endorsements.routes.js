import express from "express";
import {
  buildTaskPayloadFromEndorsement,
  createEndorsement,
  deleteEndorsement,
  getEndorsementOptions,
  getEndorsementSummary,
  listEndorsements,
  seedEndorsementsIfEmpty,
  syncModeledEndorsements,
  updateEndorsement
} from "../services/endorsements.service.js";

const router = express.Router();

const numericId = (value) => {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : null;
};

router.get("/health", async (_req, res) => {
  try {
    await seedEndorsementsIfEmpty();

    return res.json({
      ok: true,
      service: "endorsement-intelligence",
      status: "ready",
    });
  } catch (error) {
    console.error("Endorsement health error:", error);

    return res.status(500).json({
      ok: false,
      error:
        error.message ||
        "Endorsement intelligence health check failed",
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const result = await listEndorsements(req.query || {});

    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Endorsement list error:", error);

    return res.status(500).json({
      error:
        error.message ||
        "Failed to load endorsements",
    });
  }
});

router.get("/summary", async (req, res) => {
  try {
    const result = await getEndorsementSummary(req.query || {});

    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Endorsement summary error:", error);

    return res.status(500).json({
      error:
        error.message ||
        "Failed to load endorsement summary",
    });
  }
});

router.get("/options", async (_req, res) => {
  try {
    const result = await getEndorsementOptions();

    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Endorsement options error:", error);

    return res.status(500).json({
      error:
        error.message ||
        "Failed to load endorsement options",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const endorsement = await createEndorsement(req.body || {});

    return res.status(201).json({
      ok: true,
      endorsement,
    });
  } catch (error) {
    console.error("Endorsement create error:", error);

    return res.status(500).json({
      error:
        error.message ||
        "Failed to create endorsement",
    });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = numericId(req.params.id);

    if (!id) {
      return res.status(400).json({
        error: "Invalid endorsement id",
      });
    }

    const endorsement = await updateEndorsement(
      id,
      req.body || {}
    );

    if (!endorsement) {
      return res.status(404).json({
        error: "Endorsement not found",
      });
    }

    return res.json({
      ok: true,
      endorsement,
    });
  } catch (error) {
    console.error("Endorsement update error:", error);

    return res.status(500).json({
      error:
        error.message ||
        "Failed to update endorsement",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = numericId(req.params.id);

    if (!id) {
      return res.status(400).json({
        error: "Invalid endorsement id",
      });
    }

    const deleted = await deleteEndorsement(id);

    if (!deleted) {
      return res.status(404).json({
        error: "Endorsement not found",
      });
    }

    return res.json({
      ok: true,
      deleted: true,
    });
  } catch (error) {
    console.error("Endorsement delete error:", error);

    return res.status(500).json({
      error:
        error.message ||
        "Failed to delete endorsement",
    });
  }
});

router.post("/sync-modeled", async (req, res) => {
  try {
    const result = await syncModeledEndorsements(
      req.body || {}
    );

    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Endorsement modeled sync error:", error);

    return res.status(500).json({
      error:
        error.message ||
        "Failed to sync modeled endorsements",
    });
  }
});

router.post("/:id/task-payload", async (req, res) => {
  try {
    const id = numericId(req.params.id);

    if (!id) {
      return res.status(400).json({
        error: "Invalid endorsement id",
      });
    }

    const all = await listEndorsements({
      limit: 250,
    });

    const endorsement = all.results.find(
      (item) => Number(item.id) === Number(id)
    );

    if (!endorsement) {
      return res.status(404).json({
        error: "Endorsement not found",
      });
    }

    return res.json({
      ok: true,
      task: buildTaskPayloadFromEndorsement(
        endorsement
      ),
    });
  } catch (error) {
    console.error(
      "Endorsement task payload error:",
      error
    );

    return res.status(500).json({
      error:
        error.message ||
        "Failed to build endorsement task payload",
    });
  }
});

export default router;
