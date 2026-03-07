import express from "express"
import cors from "cors"

import candidatesRoutes from "./routes/candidates.routes.js"
import dropdownRoutes from "./routes/dropdowns.routes.js"
import aiRoutes from "./routes/ai.routes.js"

import mapRoutes from "./routes/map.routes.js"
import influenceRoutes from "./routes/influence.routes.js"
import consultantsRoutes from "./routes/consultants.routes.js"

import moneyRoutes from "./routes/money.routes.js"
import alertsRoutes from "./routes/alerts.routes.js"
import networkRoutes from "./routes/network.routes.js"

const app = express()

app.use(cors())
app.use(express.json())

app.get("/", (req, res) => {
    res.json({
        platform: "VoterSpheres Political Intelligence Engine",
        status: "running"
    })
})

app.use("/candidates", candidatesRoutes)
app.use("/dropdowns", dropdownRoutes)

app.use("/ai", aiRoutes)

app.use("/map", mapRoutes)
app.use("/influence", influenceRoutes)
app.use("/consultants", consultantsRoutes)

app.use("/money", moneyRoutes)
app.use("/alerts", alertsRoutes)
app.use("/network", networkRoutes)

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
})
