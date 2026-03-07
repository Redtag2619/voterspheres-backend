import express from "express"
import db from "../db.js"

const router = express.Router()

/*
===========================================
AI ELECTION FORECAST ENGINE
===========================================
Predict race competitiveness
*/

router.get("/forecast", async (req, res) => {

    try {

        const query = `
        SELECT
            c.name,
            c.party,
            c.state,
            c.office,
            SUM(d.amount) as fundraising
        FROM candidates c
        LEFT JOIN donations d
        ON c.id = d.candidate_id
        GROUP BY c.id
        `

        const result = await db.query(query)

        const forecast = result.rows.map(c => {

            let score = 0

            if (c.party === "Democrat") score += 50
            if (c.party === "Republican") score += 50

            if (c.fundraising > 1000000) score += 20
            if (c.fundraising > 5000000) score += 40

            let rating = "Lean"

            if (score > 70) rating = "Likely"
            if (score > 90) rating = "Safe"

            return {
                candidate: c.name,
                state: c.state,
                office: c.office,
                fundraising: c.fundraising,
                forecast: rating
            }
        })

        res.json(forecast)

    } catch (err) {

        console.error(err)
        res.status(500).json({ error: "Forecast engine failed" })

    }

})

/*
===========================================
AI DONOR TARGETING ENGINE
===========================================
Find top donors similar to current supporters
*/

router.get("/donor-targeting/:candidateId", async (req, res) => {

    try {

        const { candidateId } = req.params

        const query = `
        SELECT
            donor_name,
            SUM(amount) as total_donated
        FROM donations
        WHERE candidate_id != $1
        GROUP BY donor_name
        ORDER BY total_donated DESC
        LIMIT 25
        `

        const result = await db.query(query, [candidateId])

        res.json({
            candidate: candidateId,
            top_targets: result.rows
        })

    } catch (err) {

        console.error(err)
        res.status(500).json({ error: "Donor targeting AI failed" })

    }

})

/*
===========================================
AI OPPOSITION RESEARCH ENGINE
===========================================
Detect vulnerabilities
*/

router.get("/opposition-research/:candidateId", async (req, res) => {

    try {

        const { candidateId } = req.params

        const donations = await db.query(`
        SELECT donor_name, amount
        FROM donations
        WHERE candidate_id = $1
        ORDER BY amount DESC
        LIMIT 10
        `, [candidateId])

        const flags = donations.rows.map(d => {

            if (d.amount > 50000) {
                return {
                    donor: d.donor_name,
                    risk: "High Influence Donor",
                    amount: d.amount
                }
            }

            return null

        }).filter(Boolean)

        res.json({
            candidate: candidateId,
            opposition_flags: flags
        })

    } catch (err) {

        console.error(err)
        res.status(500).json({ error: "Opposition research AI failed" })

    }

})

export default router
