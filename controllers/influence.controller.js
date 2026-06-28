import {
  ensureInfluenceSchema,
  getInfluenceAlerts,
  getInfluenceEntity,
  getInfluenceRankings,
  getInfluenceSummary,
  syncInfluenceEngine,
} from "../services/influence.service.js";

export async function influenceHealth(req, res, next) {
  try {
    await ensureInfluenceSchema();
    res.json({
      ok: true,
      service: "influence-engine",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

export async function syncInfluence(req, res, next) {
  try {
    const result = await syncInfluenceEngine();
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function influenceSummary(req, res, next) {
  try {
    const result = await getInfluenceSummary();
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function influenceRankings(req, res, next) {
  try {
    const result = await getInfluenceRankings({
      state: req.query.state,
      type: req.query.type,
      limit: req.query.limit,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function influenceState(req, res, next) {
  try {
    const result = await getInfluenceRankings({
      state: req.params.state,
      type: req.query.type,
      limit: req.query.limit || 100,
    });

    res.json({
      state: String(req.params.state || "").toUpperCase(),
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function influenceEntity(req, res, next) {
  try {
    const result = await getInfluenceEntity({
      entityKey: req.query.entityKey || req.query.key,
      entityType: req.query.entityType || req.query.type,
      entityName: req.query.entityName || req.query.name,
      state: req.query.state,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function influenceAlerts(req, res, next) {
  try {
    const result = await getInfluenceAlerts({
      state: req.query.state,
      severity: req.query.severity,
      limit: req.query.limit,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}
