import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";

import candidatesRoutes from "./routes/candidates.routes.js";
import dropdownRoutes from "./routes/dropdowns.routes.js";
import organizationRoutes from "./routes/organizations.routes.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

/*
Routes
*/
app.use("/candidates", candidatesRoutes);
app.use("/dropdowns", dropdownRoutes);
app.use("/organizations", organizationRoutes);

/*
Health check
*/
app.get("/", (req, res) => {
    res.send("VoterSpheres API running");
});

/*
MongoDB
*/
mongoose.connect(process.env.MONGO_URI)
.then(() => {
    console.log("MongoDB connected");

    const PORT = process.env.PORT || 5000;

    app.listen(PORT, () =>
        console.log(`Server running on port ${PORT}`)
    );
})
.catch(err => console.error(err));
