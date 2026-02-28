import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { config } from "./config.js";
import authRoutes from "./routes/auth.routes.js";
import { authenticate } from "./middleware/auth.js";

const app = express();

app.use(helmet());
app.use(compression());
app.use(express.json());

app.use(cors({
  origin: [
    "https://voterspheres.org",
    "https://www.voterspheres.org"
  ]
}));

app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);

app.get("/api/protected", requireAuth, (req, res) => {
  res.json({ message: "You are authenticated" });
});

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
