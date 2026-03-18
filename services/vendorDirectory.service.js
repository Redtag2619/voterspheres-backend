import {
  getVendorCategoryOptions,
  getVendorDirectory,
  getVendorDirectorySummary,
  getVendorStatusOptions
} from "../repositories/vendorDirectory.repository.js";

export async function listVendorDirectory(req, res, next) {
  try {
    const filters = {
      search: req.query.search || "",
      category: req.query.category || "",
      status: req.query.status || "",
      state: req.query.state || "",
      campaign_id: req.query.campaign_id || "",
      firm_id: req.query.firm_id || "",
      page: req.query.page || 1,
      limit: req.query.limit || 25
    };

    const [directory, summary] = await Promise.all([
      getVendorDirectory(filters),
      getVendorDirectorySummary(filters)
    ]);

    res.json({
      ...directory,
      summary
    });
  } catch (err) {
    next(err);
  }
}

export async function listVendorCategoryDropdown(req, res, next) {
  try {
    const results = await getVendorCategoryOptions();
    res.json({ results });
  } catch (err) {
    next(err);
  }
}

export async function listVendorStatusDropdown(req, res, next) {
  try {
    const results = await getVendorStatusOptions();
    res.json({ results });
  } catch (err) {
    next(err);
  }
}
