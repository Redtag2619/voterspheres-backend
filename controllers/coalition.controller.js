import {
  ensureCoalitionSchema,
  getCoalitionActions,
  getCoalitionDetail,
  getCoalitionRankings,
  getCoalitionSummary,
  recalculateCoalitionIntelligence,
} from "../services/coalitionIntelligence.service.js";

export async function coalitionHealth(req, res, next) {
  try {
    await ensureCoalitionSchema();

    res.json({
      ok: true,
      service: "coalition-intelligence",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

export async function coalitionRecalculate(req, res, next) {
  try {
    const result = await recalculateCoalitionIntelligence();
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function coalitionSummary(req, res, next) {
  try {
    const result = await getCoalitionSummary();
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function coalitionRankings(req, res, next) {
  try {
    const result = await getCoalitionRankings({
      state: req.query.state,
      type: req.query.type,
      limit: req.query.limit,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function coalitionActions(req, res, next) {
  try {
    const result = await getCoalitionActions({
      state: req.query.state,
      priority: req.query.priority,
      limit: req.query.limit,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function coalitionDetail(req, res, next) {
  try {
    const result = await getCoalitionDetail({
      coalitionKey: req.params.key,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}
