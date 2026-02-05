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
   DROPDOWN ROUTES
============================ */

/* STATES */

app.get("/api/dropdowns/states", async (req,res)=>{
  try{
    const { rows } = await pool.query(
      "SELECT id, name FROM states ORDER BY name"
    );
    res.json(rows);
  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

/* DYNAMIC COUNTIES BY STATE */

app.get("/api/dropdowns/counties", async (req,res)=>{
  try{
    const { state } = req.query;

    if(!state){
      return res.json([]);
    }

    const { rows } = await pool.query(
      `SELECT id, name 
       FROM counties 
       WHERE state_id = $1 
       ORDER BY name`,
      [state]
    );

    res.json(rows);

  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

/* OFFICES */

app.get("/api/dropdowns/offices", async (req,res)=>{
  try{
    const { rows } = await pool.query(
      "SELECT id, name FROM offices ORDER BY name"
    );
    res.json(rows);
  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

/* PARTIES */

app.get("/api/dropdowns/parties", async (req,res)=>{
  try{
    const { rows } = await pool.query(
      "SELECT id, name FROM parties ORDER BY name"
    );
    res.json(rows);
  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

/* ============================
   CANDIDATE SEARCH + PAGINATION
============================ */

app.get("/api/candidates", async (req,res)=>{
  try{

    const {
      q = "",
      state = "",
      county = "",
      office = "",
      party = "",
      page = 1,
      limit = 12
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
      where.push(`s.id = $${values.length}`);
    }

    if(county){
      values.push(county);
      where.push(`co.id = $${values.length}`);
    }

    if(office){
      values.push(office);
      where.push(`o.id = $${values.length}`);
    }

    if(party){
      values.push(party);
      where.push(`p.id = $${values.length}`);
    }

    const whereSQL = where.length ? "WHERE " + where.join(" AND ") : "";

    /* ===== TOTAL COUNT ===== */

    const countQuery = `
      SELECT COUNT(*) 
      FROM candidates c
      LEFT JOIN states s ON c.state_id = s.id
      LEFT JOIN counties co ON c.county_id = co.id
      LEFT JOIN offices o ON c.office_id = o.id
      LEFT JOIN parties p ON c.party_id = p.id
      ${whereSQL}
    `;

    const totalResult = await pool.query(countQuery, values);
    const total = Number(totalResult.rows[0].count);

    /* ===== PAGED RESULTS ===== */

    values.push(limit);
    values.push(offset);

    const dataQuery = `
      SELECT 
        c.id,
        c.full_name,
        c.email,
        c.phone,
        s.name AS state_name,
        co.name AS county_name,
        o.name AS office_name,
        p.name AS party_name
      FROM candidates c
      LEFT JOIN states s ON c.state_id = s.id
      LEFT JOIN counties co ON c.county_id = co.id
      LEFT JOIN offices o ON c.office_id = o.id
      LEFT JOIN parties p ON c.party_id = p.id
      ${whereSQL}
      ORDER BY c.full_name
      LIMIT $${values.length-1}
      OFFSET $${values.length}
    `;

    const results = await pool.query(dataQuery, values);

    res.json({
      total,
      results: results.rows
    });

  }catch(err){
    console.error("CANDIDATE SEARCH ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================
   SERVER START
============================ */

app.listen(PORT, ()=>{
  console.log(`🚀 Backend running on port ${PORT}`);
});
