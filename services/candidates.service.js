import {
  countCandidates,
  findCandidates,
  findDistinctCandidateStates,
  findDistinctCandidateOffices,
  findDistinctCandidateParties
} from "../repositories/candidates.repository.js";

export async function getCandidates(req, res, next) {
  try {
    const {
      q = "",
      state = "",
      office = "",
      party = "",
      page = 1,
      limit = 12
    } = req.query;

    const filters = {
      q: String(q).trim(),
      state: String(state).trim(),
      office: String(office).trim(),
      party: String(party).trim(),
      page: Number(page) > 0 ? Number(page) : 1,
      limit: Number(limit) > 0 ? Number(limit) : 12
    };

    const [total, results] = await Promise.all([
      countCandidates(filters),
      findCandidates(filters)
    ]);

    res.json({
      total,
      results
    });
  } catch (err) {
    next(err);
  }
}

export async function getCandidateStates(_req, res, next) {
  try {
    const states = await findDistinctCandidateStates();
    res.json(states);
  } catch (err) {
    next(err);
  }
}

export async function getCandidateOffices(_req, res, next) {
  try {
    const offices = await findDistinctCandidateOffices();
    res.json(offices);
  } catch (err) {
    next(err);
  }
}

export async function getCandidateParties(_req, res, next) {
  try {
    const parties = await findDistinctCandidateParties();
    res.json(parties);
  } catch (err) {
    next(err);
  }
}

export async function getCandidateCounties(_req, res, next) {
  try {
    res.json([]);
  } catch (err) {
    next(err);
  }
}
