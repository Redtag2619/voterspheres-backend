import dotenv from "dotenv";
import { pool } from "../db/pool.js";
import { ensureInfluenceForecastSchema } from "../services/influenceForecast.service.js";

dotenv.config();

async function main() {
  try {
    console.log("Preparing Influence Forecast schema...");
    await ensureInfluenceForecastSchema();
    console.log("Influence Forecast schema ready.");
  } catch (error) {
    console.error("Influence Forecast migration failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
