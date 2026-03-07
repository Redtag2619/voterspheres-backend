import express from "express"
import db from "../db.js"

const router = express.Router()

/*
========================================
POLITICAL RELATIONSHIP GRAPH
========================================
Builds donor → candidate relationships
*/

router.get("/relationships", async (req, res) => {

    try {

        const query = `
        SELECT
            d.donor_name,
            c.name as candidate,
            d.amount
        FROM donations d
        JOIN candidates c
        ON d.candidate_id = c.id
        ORDER BY d.amount DESC
        LIMIT 200
        `

        const result = await db.query(query)

        const relationships = result.rows.map(r => ({
            donor: r.donor_name,
            candidate: r.candidate,
            amount: r.amount
        }))

        res.json({
            relationships
        })

    } catch (err) {

        console.error(err)
        res.status(500).json({ error: "Relationship graph failed" })

    }

})

export default router
