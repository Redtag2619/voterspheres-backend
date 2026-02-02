app.get("/api/search/candidates", async (req, res) => {
  try {
    const {
      q = "",
      state,
      party,
      office,
      page = 1,
      limit = 50
    } = req.query;

    const offset = (page - 1) * limit;

    let filters = [];
    let values = [];
    let i = 1;

    if (q) {
      filters.push(`c.full_name ILIKE $${i++}`);
      values.push(`%${q}%`);
    }

    if (state) {
      filters.push(`s.code = $${i++}`);
      values.push(state);
    }

    if (party) {
      filters.push(`p.abbreviation = $${i++}`);
      values.push(party);
    }

    if (office) {
      filters.push(`o.name = $${i++}`);
      values.push(office);
    }

    const whereClause = filters.length
      ? "WHERE " + filters.join(" AND ")
      : "";

    const query = `
      SELECT
        c.id,
        c.full_name,
        s.code AS state,
        co.name AS county,
        p.abbreviation AS party,
        o.name AS office,
        c.website,
        c.email,
        c.phone
      FROM candidates c
      JOIN states s ON c.state_id = s.id
      LEFT JOIN counties co ON c.county_id = co.id
      LEFT JOIN parties p ON c.party_id = p.id
      LEFT JOIN offices o ON c.office_id = o.id
      ${whereClause}
      ORDER BY c.full_name
      LIMIT $${i++} OFFSET $${i++}
    `;

    values.push(limit, offset);

    const result = await pool.query(query, values);

    res.json({
      page: Number(page),
      results: result.rows.length,
      data: result.rows
    });

  } catch (err) {
    console.error("SEARCH ERROR:", err);
    res.status(500).json({ error: "Search failed" });
  }
});
