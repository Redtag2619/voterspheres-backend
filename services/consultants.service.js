import {
  countConsultants,
  findConsultants,
  findDistinctConsultantStates
} from "../repositories/consultants.repository.js";

export async function getConsultants(req, res, next) {
  try {
    const {
      q = "",
      state = "",
      page = 1,
      limit = 12
    } = req.query;

    const filters = {
      q: String(q).trim(),
      state: String(state).trim(),
      page: Number(page) > 0 ? Number(page) : 1,
      limit: Number(limit) > 0 ? Number(limit) : 12
    };

    const [total, results] = await Promise.all([
      countConsultants(filters),
      findConsultants(filters)
    ]);

    res.json({
      total,
      results
    });
  } catch (err) {
    next(err);
  }
}

export async function getConsultantStates(_req, res, next) {
  try {
    const states = await findDistinctConsultantStates();
    res.json(states);
  } catch (err) {
    next(err);
  }
}
