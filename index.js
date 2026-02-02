app.get("/api/search/consultants", async (req, res) => {
  try {
    const { q = "", state } = req.query;

    const result = await pool.query(
      `
      SELECT 
        c.id,
        c.name,
        s.code AS state,
        c.email,
        c.phone,
        c.website
      FROM consultants c
      JOIN states s ON c.state_id = s.id
      WHERE 
        c.name ILIKE $1
        AND ($2::text IS NULL OR s.code = $2)
      ORDER BY c.name
      LIMIT 100
      `,
      [`%${q}%`, state || null]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Consultant search failed" });
  }
});
