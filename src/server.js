import express from "express";
import cors from "cors";

import candidatesRoutes from "./routes/candidates.routes.js";
import dropdownRoutes from "./routes/dropdowns.routes.js";
import marketplaceRoutes from "./routes/marketplace.routes.js";
import riskRoutes from "./routes/risk.routes.js";
import mapRoutes from "./routes/map.routes.js";

import warroomRoutes from "./routes/warroom.routes.js";
import donorsRoutes from "./routes/donors.routes.js";
import influenceRoutes from "./routes/influence.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("VoterSpheres Political Intelligence Platform Running");
});

/* Core APIs */

app.use("/candidates", candidatesRoutes);
app.use("/dropdowns", dropdownRoutes);

/* Intelligence APIs */

app.use("/marketplace", marketplaceRoutes);
app.use("/risk", riskRoutes);
app.use("/map", mapRoutes);

/* Advanced Intelligence APIs */

app.use("/warroom", warroomRoutes);
app.use("/donors", donorsRoutes);
app.use("/influence", influenceRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
