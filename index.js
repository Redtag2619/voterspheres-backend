import express from 'express';
import pkg from 'pg';

const { Pool } = pkg;

const app = express();
app.use(express.json());

// ---- HEALTH CHECK (REQUIRED BY RENDER) ----
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// ---- DATABASE ----
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

// ---- ROLLBACK ENDPOINT ----
app.post('/rollback/execute', async (req, res) => {
  const { requestId, execute = true, forceOverride = false } = req.body;

  if (!requestId) {
    return res.status(400).json({ error: 'requestId required' });
  }

  try {
    await pool.query(
      'SELECT rollback.execute_request($1, $2, $3)',
      [requestId, execute, forceOverride]
    );

    res.json({ status: 'success', requestId });
  } catch (err) {
    console.error('Rollback error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- START SERVER ----
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
