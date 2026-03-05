import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import candidatesRoutes from "./routes/candidates.routes.js";
import dropdownRoutes from "./routes/dropdowns.routes.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

/*
ROUTES
*/
app.use("/candidates", candidatesRoutes);
app.use("/dropdowns", dropdownRoutes);

/*
HEALTH CHECK
*/
app.get("/", (req, res) => {
  res.json({
    status: "VoterSpheres API running"
  });
});

/*
SERVER
*/
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
