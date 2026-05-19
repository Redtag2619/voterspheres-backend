import { getRelationshipGraph } from "../services/relationshipGraph.service.js";

export async function getRelationshipGraphController(req, res) {
  try {
    const graph = await getRelationshipGraph(req.query || {});

    return res.status(200).json({
      ok: true,
      graph,
      ...graph,
    });
  } catch (error) {
    console.error("Relationship graph controller error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load relationship graph",
    });
  }
}
