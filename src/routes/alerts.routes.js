import express from "express"
import db from "../db.js"

const router = express.Router()

/*
========================================
CAMPAIGN WAR ROOM ALERTS
========================================
Detect unusual fundraising activity
*/

router.get("/fundraising-alerts", async (req, res) => {

    try {

        const query = `
        SELECT
            candidate_id,
            SUM(amount) as total
        FROM donations
        GROUP BY candidate_id
        HAVING SUM(amount) > 50000
        ORDER BY total DESC
        `

        const result = await db.query(query)

        const alerts = result.rows.map(row => ({
            type: "Fundraising Surge",
            candidate_id: row.candidate_id,
            amount: row.total
        }))

        res.json({
            alerts
        })

    } catch (err) {

        console.error(err)
        res.status(500).json({ error: "Alert system failed" })

    }

})

export default router
