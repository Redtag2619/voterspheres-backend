import express from "express"
import cors from "cors"
import dotenv from "dotenv"

import candidatesRoutes from "./routes/candidates.routes.js"
import electionsRoutes from "./routes/elections.routes.js"
import issuesRoutes from "./routes/issues.routes.js"
import messagesRoutes from "./routes/messages.routes.js"
import persuasionRoutes from "./routes/persuasion.routes.js"
import fundraisingRoutes from "./routes/fundraising.routes.js"
import consultantsRoutes from "./routes/consultants.routes.js"
import strategyRoutes from "./routes/strategy.routes.js"

dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())

app.get("/",(req,res)=>{
 res.json({
  platform:"VoterSpheres",
  engine:"Political Intelligence Platform",
  version:"1.0"
 })
})

app.use("/candidates",candidatesRoutes)
app.use("/elections",electionsRoutes)
app.use("/issues",issuesRoutes)
app.use("/messages",messagesRoutes)
app.use("/persuasion",persuasionRoutes)
app.use("/fundraising",fundraisingRoutes)
app.use("/consultants",consultantsRoutes)
app.use("/strategy",strategyRoutes)

const PORT = process.env.PORT || 5000

app.listen(PORT,()=>{
 console.log(`VoterSpheres Intelligence API running on ${PORT}`)
})
