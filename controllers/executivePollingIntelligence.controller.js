import {
  getExecutivePollingDashboard,
  getExecutivePollingHealth,
  listExecutivePollingRecords,
} from "../services/executivePollingIntelligence.service.js";

export async function getExecutivePollingDashboardController(
  req,
  res,
  next
) {
  try {
    res.json(
      await getExecutivePollingDashboard({
        query: req.query || {},
      })
    );
  } catch (error) {
    next(error);
  }
}

export async function listExecutivePollingRecordsController(
  req,
  res,
  next
) {
  try {
    res.json(
      await listExecutivePollingRecords({
        query: req.query || {},
      })
    );
  } catch (error) {
    next(error);
  }
}

export async function getExecutivePollingHealthController(
  _req,
  res,
  next
) {
  try {
    res.json(await getExecutivePollingHealth());
  } catch (error) {
    next(error);
  }
}

