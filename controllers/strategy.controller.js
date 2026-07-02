import {
  ensureStrategySchema,
  getStrategyDetail,
  getStrategyRecommendations,
  getStrategySummary,
  queueStrategyAction,
  recalculateStrategyRecommendations,
} from "../services/strategyRecommendation.service.js";

export async function strategyHealth(req, res, next) {
  try {
    await ensureStrategySchema();
    res.json({ ok: true, service: "strategy-recommendation-engine", timestamp: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
}

export async function strategyRecalculate(req, res, next) {
  try {
    res.json(await recalculateStrategyRecommendations());
  } catch (error) {
    next(error);
  }
}

export async function strategySummary(req, res, next) {
  try {
    res.json(await getStrategySummary());
  } catch (error) {
    next(error);
  }
}

export async function strategyRecommendations(req, res, next) {
  try {
    res.json(await getStrategyRecommendations({
      state: req.query.state,
      type: req.query.type,
      priority: req.query.priority,
      limit: req.query.limit,
    }));
  } catch (error) {
    next(error);
  }
}

export async function strategyDetail(req, res, next) {
  try {
    res.json(await getStrategyDetail({ key: req.params.key }));
  } catch (error) {
    next(error);
  }
}

export async function strategyQueueAction(req, res, next) {
  try {
    res.json(await queueStrategyAction({ recommendationKey: req.params.key || req.body?.recommendation_key }));
  } catch (error) {
    next(error);
  }
}
