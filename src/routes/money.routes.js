import express from "express"
import db from "../db.js"

const router = express.Router()

/*
========================================
POLITICAL MONEY TRACKER
========================================
Shows fundraising totals by candidate
*/

router.get("/fundraising", async (req, res) => {

    try {

        const query = `
        SELECT
            c.name as candidate,
            c.state,
            c.party,
            SUM(d.amount) as total_fundraising
        FROM candidates c
        LEFT JOIN donations d
        ON c.id = d.candidate_id
        GROUP BY c.name, c.state, c.party
        ORDER BY total_fundraising DESC
        LIMIT 100
        `

        const result = await db.query(query)

        res.json({
            fundraising: result.rows
        })

    } catch (err) {

        console.error(err)
        res.status(500).json({ error: "Money tracker failed" })

    }

})

export default router
