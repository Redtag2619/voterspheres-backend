import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

/* ============================
   DATABASE CONNECTION
============================ */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

async function testDB(){
  try{
    await pool.query("SELECT 1");
    console.log("✅ Connected to database");
  }catch(err){
    console.error("❌ DB CONNECTION ERROR:", err);
  }
}

testDB();

/* ============================
   DROPDOWNS
============================ */

app.get("/api/dropdowns/states", async (req,res)=>{
  const { rows } = await pool.query(
    "SELECT id, name FROM states ORDER BY name"
  );
  res.json(rows);
});

app.get("/api/dropdowns/counties", async (req,res)=>{
  const { state } = req.query;

  if(!state) return res.json([]);

  const { rows } = await pool.query(
    `SELECT id, name FROM counties
     WHERE state_id=$1
     ORDER BY name`,
    [state]
  );

  res.json(rows);
});

app.get("/api/dropdowns/offices", async (req,res)=>{
  const { rows } = await pool.query(
    "SELECT id, name FROM offices ORDER BY name"
  );
  res.json(rows);
});

app.get("/api/dropdowns/parties", async (req,res)=>{
  const { rows } = await pool.query(
    "SELECT id, name FROM parties ORDER BY name"
  );
  res.json(rows);
});

/* CONSULTANT DROPDOWN */

app.get("/api/dropdowns/consultants", async (req,res)=>{
  const { rows } = await pool.query(
    "SELECT id, name FROM consultants ORDER BY name"
  );
  res.json(rows);
});

/* VENDOR DROPDOWN */

app.get("/api/dropdowns/vendors", async (req,res)=>{
  const { rows } = await pool.query(
    "SELECT id, name FROM vendors ORDER BY name"
  );
  res.json(rows);
});

/* ============================
   CANDIDATES SEARCH
============================ */

app.get("/api/candidates", async (req,res)=>{
  try{

    const {
      q="",
      state="",
      county="",
      office="",
      party="",
      page=1,
      limit=12
    } = req.query;

    const offset = (page - 1) * limit;
    let where = [];
    let values = [];

    if(q){
      values.push(`%${q}%`);
      where.push(`c.full_name ILIKE $${values.length}`);
    }
    if(state){
      values.push(state);
      where.push(`c.state_id=$${values.length}`);
    }
    if(county){
      values.push(county);
      where.push(`c.county_id=$${values.length}`);
    }
    if(office){
      values.push(office);
      where.push(`c.office_id=$${values.length}`);
    }
    if(party){
      values.push(party);
      where.push(`c.party_id=$${values.length}`);
    }

    const whereSQL = where.length ? "WHERE " + where.join(" AND ") : "";

    const totalRes = await pool.query(
      `SELECT COUNT(*) FROM candidates c ${whereSQL}`,
      values
    );

    const total = Number(totalRes.rows[0].count);

    values.push(limit, offset);

    const dataRes = await pool.query(
      `
      SELECT c.*, 
             s.name AS state_name,
             co.name AS county_name,
             o.name AS office_name,
             p.name AS party_name
      FROM candidates c
      LEFT JOIN states s ON c.state_id=s.id
      LEFT JOIN counties co ON c.county_id=co.id
      LEFT JOIN offices o ON c.office_id=o.id
      LEFT JOIN parties p ON c.party_id=p.id
      ${whereSQL}
      ORDER BY c.full_name
      LIMIT $${values.length-1}
      OFFSET $${values.length}
      `,
      values
    );

    res.json({ total, results: dataRes.rows });

  }catch(err){
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================
   CONSULTANTS API
============================ */

app.get("/api/consultants", async (req,res)=>{
  try{

    const { q="", state="", page=1, limit=12 } = req.query;

    const offset = (page - 1) * limit;
    let where = [];
    let values = [];

    if(q){
      values.push(`%${q}%`);
      where.push(`name ILIKE $${values.length}`);
    }

    if(state){
      values.push(state);
      where.push(`state_id=$${values.length}`);
    }

    const whereSQL = where.length ? "WHERE " + where.join(" AND ") : "";

    const totalRes = await pool.query(
      `SELECT COUNT(*) FROM consultants ${whereSQL}`,
      values
    );

    const total = Number(totalRes.rows[0].count);

    values.push(limit, offset);

    const dataRes = await pool.query(
      `
      SELECT c.*, s.name AS state_name
      FROM consultants c
      LEFT JOIN states s ON c.state_id=s.id
      ${whereSQL}
      ORDER BY c.name
      LIMIT $${values.length-1}
      OFFSET $${values.length}
      `,
      values
    );

    res.json({ total, results: dataRes.rows });

  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

/* ============================
   VENDORS API
============================ */

app.get("/api/vendors", async (req,res)=>{
  try{

    const { q="", state="", page=1, limit=12 } = req.query;

    const offset = (page - 1) * limit;
    let where = [];
    let values = [];

    if(q){
      values.push(`%${q}%`);
      where.push(`name ILIKE $${values.length}`);
    }

    if(state){
      values.push(state);
      where.push(`state_id=$${values.length}`);
    }

    const whereSQL = where.length ? "WHERE " + where.join(" AND ") : "";

    const totalRes = await pool.query(
      `SELECT COUNT(*) FROM vendors ${whereSQL}`,
      values
    );

    const total = Number(totalRes.rows[0].count);

    values.push(limit, offset);

    const dataRes = await pool.query(
      `
      SELECT v.*, s.name AS state_name
      FROM vendors v
      LEFT JOIN states s ON v.state_id=s.id
      ${whereSQL}
      ORDER BY v.name
      LIMIT $${values.length-1}
      OFFSET $${values.length}
      `,
      values
    );

    res.json({ total, results: dataRes.rows });

  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

/* ============================
   SERVER
============================ */

app.listen(PORT, ()=>{
  console.log(`🚀 Backend running on port ${PORT}`);
});
