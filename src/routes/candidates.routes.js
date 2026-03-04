import usageMiddleware from "../middleware/usage.middleware.js";
import pool from "../db.js";
import express from "express";
import authMiddleware from "../middleware/auth.middleware.js";

const router = express.Router();

/**
 * GET /candidates
 * Query params:
 *   q      = search name
 *   state  = state abbreviation (TX, CA, etc.)
 *   party  = DEM, REP, etc.
 *   page   = page number
 *   limit  = results per page
 */
router.get("/", authMiddleware, usageMiddleware, async (req, res) => {

  try {
    const {
      q = "",
      state = "",
      party = "",
      page = 1,
      limit = 10,
    } = req.query;

    const apiKey = process.env.FEC_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "FEC_API_KEY not configured in environment variables",
      });
    }

    const fecUrl = new URL("https://api.open.fec.gov/v1/candidates/");

    fecUrl.searchParams.append("api_key", apiKey);
    fecUrl.searchParams.append("per_page", limit);
    fecUrl.searchParams.append("page", page);

    if (state) {
      fecUrl.searchParams.append("state", state);
    }

    if (party) {
      fecUrl.searchParams.append("party", party);
    }

    if (q) {
      fecUrl.searchParams.append("q", q);
    }

    const response = await fetch(fecUrl.toString());

    if (!response.ok) {
      const text = await response.text();
      console.error("FEC API Error:", text);
      return res.status(500).json({ error: "FEC API request failed" });
    }

    const data = await response.json();

    const formattedResults = (data.results || []).map((candidate) => ({
      full_name: candidate.name || "",
      office_name: candidate.office_full || candidate.office || "",
      state_name: candidate.state || "",
      party_name: candidate.party_full || candidate.party || "",
      county_name: "",
      email: "",
      phone: "",
    }));

    await pool.query(
  `INSERT INTO usage_logs (organization_id, action_type)
   VALUES ($1, 'candidate_search')`,
  [req.user.organizationId]
);

    return res.json({
      results: formattedResults,
      total: data.pagination?.count || 0,
    });

  } catch (error) {
    console.error("Candidates route error:", error);
    return res.status(500).json({
      error: "Internal server error fetching candidates",
    });
  }
});

export default router;
