import {
  getLatestStoredCandidates,
  getLatestStoredFundraising
} from "../repositories/fecIngestion.repository.js";
import { runFecCandidateIngestion } from "../jobs/fecCandidateIngestion.job.js";

export async function triggerFecCandidateIngestion(req, res, next) {
  try {
    const cycle = Number(req.body?.cycle || process.env.FEC_CYCLE || 2026);
    const limit = Number(req.body?.limit || process.env.FEC_INGEST_LIMIT || 5);
    const office = String(req.body?.office || "");
    const state = String(req.body?.state || "");
    const q = String(req.body?.q || "");

    const result = await runFecCandidateIngestion({
      cycle,
      limit,
      office,
      state,
      q
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getStoredFecCandidates(req, res, next) {
  try {
    const limit = Number(req.query.limit || 100);
    const rows = await getLatestStoredCandidates(limit);

    res.json({
      count: rows.length,
      results: rows
    });
  } catch (err) {
    next(err);
  }
}

export async function getStoredFundraisingSnapshots(req, res, next) {
  try {
    const limit = Number(req.query.limit || 100);
    const rows = await getLatestStoredFundraising(limit);

    res.json({
      count: rows.length,
      results: rows
    });
  } catch (err) {
    next(err);
  }
}
