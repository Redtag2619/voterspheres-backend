import {
  countCandidates,
  findCandidateById,
  findCandidateProfileById,
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
      limit: Number(limit) > 0 ? Math.min(Number(limit), 100) : 12
    };

    const [total, results] = await Promise.all([
      countCandidates(filters),
      findCandidates(filters)
    ]);

    res.json({
      total,
      page: filters.page,
      limit: filters.limit,
      results
    });
  } catch (err) {
    next(err);
  }
}

export async function getCandidateById(req, res, next) {
  try {
    const { id } = req.params;

    const [candidate, profile] = await Promise.all([
      findCandidateById(id),
      findCandidateProfileById(id)
    ]);

    if (!candidate) {
      return res.status(404).json({
        error: "Candidate not found"
      });
    }

    res.json({
      candidate,
      profile
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
