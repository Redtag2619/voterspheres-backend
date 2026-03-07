import express from "express"
import cors from "cors"

import candidatesRoutes from "./routes/candidates.routes.js"
import dropdownRoutes from "./routes/dropdowns.routes.js"
import aiRoutes from "./routes/ai.routes.js"

const app = express()

app.use(cors())
app.use(express.json())

app.get("/", (req, res) => {
    res.json({ status: "VoterSpheres API running" })
})

app.use("/candidates", candidatesRoutes)
app.use("/dropdowns", dropdownRoutes)
app.use("/ai", aiRoutes)

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
})
