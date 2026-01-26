import express from "express";
import pkg from "pg";
app.get("/", (req, res) => {
  res.send("VoterSpheres backend running");
});

const { Pool } = pkg;
const app = express();

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/approval/validate", async (req, res) => {
  const { requestId, actor } = req.body;

  try {
    const { rows } = await pool.query(
      "SELECT approval.validate_request($1, $2) AS result",
      [requestId, actor]
    );

    res.json(rows[0].result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "validation failed" });
  }
});

app.post("/rollback/execute", async (req, res) => {
  const { requestId, execute, forceOverride } = req.body;

  try {
    const { rows } = await pool.query(
      "SELECT rollback.execute_request($1, $2, $3) AS result",
      [requestId, execute, forceOverride]
    );

    res.json(rows[0].result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "rollback failed" });
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
app.get("/", (req, res) => {
  res.send("VoterSpheres Backend Running");
});
