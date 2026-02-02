app.get("/api/search/vendors", async (req, res) => {
  try {
    const { q = "", state } = req.query;

    const result = await pool.query(
      `
      SELECT 
        v.id,
        v.name,
        s.code AS state,
        v.phone,
        v.email,
        v.website
      FROM vendors v
      JOIN states s ON v.state_id = s.id
      WHERE 
        v.name ILIKE $1
        AND ($2::text IS NULL OR s.code = $2)
      ORDER BY v.name
      LIMIT 100
      `,
      [`%${q}%`, state || null]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Vendor search failed" });
  }
});
