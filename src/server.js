import express from "express";
import cors from "cors";

import candidatesRoutes from "./src/routes/candidates.routes.js";
import dropdownRoutes from "./src/routes/dropdowns.routes.js";
import marketplaceRoutes from "./src/routes/marketplace.routes.js";
import riskRoutes from "./src/routes/risk.routes.js";
import mapRoutes from "./src/routes/map.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req,res)=>{
res.send("VoterSpheres Political Intelligence API Running");
});

/* Core APIs */

app.use("/candidates", candidatesRoutes);
app.use("/dropdowns", dropdownRoutes);

/* Intelligence APIs */

app.use("/marketplace", marketplaceRoutes);
app.use("/risk", riskRoutes);
app.use("/map", mapRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT,()=>{
console.log(`Server running on port ${PORT}`);
});
