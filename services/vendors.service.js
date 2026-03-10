import {
  countVendors,
  findVendors,
  findDistinctVendorStates
} from "../repositories/vendors.repository.js";

export async function getVendors(req, res, next) {
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
      countVendors(filters),
      findVendors(filters)
    ]);

    res.json({
      total,
      results
    });
  } catch (err) {
    next(err);
  }
}

export async function getVendorStates(_req, res, next) {
  try {
    const states = await findDistinctVendorStates();
    res.json(states);
  } catch (err) {
    next(err);
  }
}
