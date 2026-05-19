import express from "express";
import { getRelationshipGraph } from "../services/relationshipGraph.service.js";

const router = express.Router();

router.get("/graph", async (req, res) => {
  try {
    const graph = await getRelationshipGraph(req.query || {});

    return res.json({
      ok: true,
      graph,
      ...graph,
    });
  } catch (error) {
    console.error("Relationship graph error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load relationship graph",
    });
  }
});

export default router;
