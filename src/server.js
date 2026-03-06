import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import candidatesRoutes from "./routes/candidates.routes.js";
import dropdownRoutes from "./routes/dropdowns.routes.js";
import intelligenceRoutes from "./routes/intelligence.routes.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

/*
----------------------------------
API ROUTES
----------------------------------
*/

app.use("/candidates", candidatesRoutes);
app.use("/dropdowns", dropdownRoutes);
app.use("/intelligence", intelligenceRoutes);

/*
----------------------------------
HEALTH CHECK
----------------------------------
*/

app.get("/", (req, res) => {
  res.json({ message: "VoterSpheres API running" });
});

/*
----------------------------------
SERVER START
----------------------------------
*/

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
