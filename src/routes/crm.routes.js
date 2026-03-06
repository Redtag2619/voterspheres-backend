import express from "express";
import pool from "../db.js";

const router = express.Router();

/*
GET CONTACTS
*/

router.get("/contacts", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT * FROM crm_contacts
      ORDER BY created_at DESC
    `);

    res.json(result.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Failed to load contacts"
    });

  }

});

/*
ADD CONTACT
*/

router.post("/contacts", async (req, res) => {

  const { name, organization, role, email, phone, state, notes } = req.body;

  try {

    const result = await pool.query(`
      INSERT INTO crm_contacts
      (name, organization, role, email, phone, state, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `,[name,organization,role,email,phone,state,notes]);

    res.json(result.rows[0]);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Failed to create contact"
    });

  }

});

export default router;
