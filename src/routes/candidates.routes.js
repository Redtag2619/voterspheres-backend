app.get("/candidates", async (req, res) => {
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
      return res.status(500).json({ error: "Missing FEC API key" });
    }

    const fecUrl = new URL("https://api.open.fec.gov/v1/candidates/");

    fecUrl.searchParams.append("api_key", apiKey);
    fecUrl.searchParams.append("per_page", limit);
    fecUrl.searchParams.append("page", page);

    if (state) fecUrl.searchParams.append("state", state);
    if (party) fecUrl.searchParams.append("party", party);
    if (q) fecUrl.searchParams.append("q", q);

    const response = await fetch(fecUrl.toString());
    const data = await response.json();

    const formattedResults = (data.results || []).map((c) => ({
      full_name: c.name,
      office_name: c.office_full || c.office,
      state_name: c.state,
      party_name: c.party_full,
      county_name: "",
      email: "",
      phone: "",
    }));

    res.json({
      results: formattedResults,
      total: data.pagination?.count || 0,
    });
  } catch (error) {
    console.error("FEC fetch error:", error);
    res.status(500).json({ error: "Failed to fetch FEC candidates" });
  }
});
