import {
  getPoliticalGraph,
  getPoliticalGraphEntity,
  getPoliticalGraphPath,
  searchPoliticalGraph,
} from "../services/politicalGraph.service.js";

export async function politicalGraphHealth(_req, res) {
  res.json({
    ok: true,
    service: "political-relationship-graph",
    status: "ready",
  });
}

export async function politicalGraphIndex(req, res) {
  try {
    const result = await getPoliticalGraph(req.query || {});
    res.json(result);
  } catch (error) {
    console.error("Political graph index error:", error);
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to load political relationship graph.",
    });
  }
}

export async function politicalGraphSearch(req, res) {
  try {
    const result = await searchPoliticalGraph(req.query || {});
    res.json(result);
  } catch (error) {
    console.error("Political graph search error:", error);
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to search political relationship graph.",
    });
  }
}

export async function politicalGraphEntity(req, res) {
  try {
    const result = await getPoliticalGraphEntity({
      ...(req.query || {}),
      id: req.params.id || req.query.id,
    });

    res.json(result);
  } catch (error) {
    console.error("Political graph entity error:", error);
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to load political graph entity.",
    });
  }
}

export async function politicalGraphRelationships(req, res) {
  try {
    const result = await getPoliticalGraphEntity(req.query || {});
    res.json(result);
  } catch (error) {
    console.error("Political graph relationships error:", error);
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to load political graph relationships.",
    });
  }
}

export async function politicalGraphPath(req, res) {
  try {
    const result = await getPoliticalGraphPath(req.query || {});
    res.json(result);
  } catch (error) {
    console.error("Political graph path error:", error);
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to calculate political graph path.",
    });
  }
}

export async function politicalGraphStats(req, res) {
  try {
    const result = await getPoliticalGraph(req.query || {});
    res.json({
      ok: true,
      summary: result.summary,
      sources: result.sources,
      actions: result.actions,
    });
  } catch (error) {
    console.error("Political graph stats error:", error);
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to load political graph stats.",
    });
  }
}
