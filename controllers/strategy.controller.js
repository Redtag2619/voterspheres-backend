import {
  ensureStrategySchema,
  getStrategyDetail,
  getStrategyHealth,
  getStrategyRecommendations,
  getStrategySummary,
  queueStrategyAction,
  recalculateStrategyRecommendations,
} from "../services/strategyRecommendation.service.js";

export async function strategyHealth(req, res, next) {
  try {
    const result = await getStrategyHealth();
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function strategyRecalculate(req, res, next) {
  try {
    const result = await recalculateStrategyRecommendations();
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function strategySummary(req, res, next) {
  try {
    await ensureStrategySchema();
    const result = await getStrategySummary();
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function strategyRecommendations(req, res, next) {
  try {
    const result = await getStrategyRecommendations({
      state: req.query.state,
      type: req.query.type,
      priority: req.query.priority,
      limit: req.query.limit,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function strategyDetail(req, res, next) {
  try {
    const result = await getStrategyDetail({
      key: req.params.key,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function strategyQueueAction(req, res, next) {
  try {
    const result = await queueStrategyAction({
      recommendationKey: req.params.key || req.body?.recommendation_key,
    });

    if (!result.ok) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
}
