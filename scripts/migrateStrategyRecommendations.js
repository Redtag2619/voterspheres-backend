import dotenv from "dotenv";
import { pool } from "../db/pool.js";
import { ensureStrategySchema } from "../services/strategyRecommendation.service.js";

dotenv.config();

async function main() {
  try {
    console.log("Preparing Strategy Recommendation Engine schema...");
    await ensureStrategySchema();
    console.log("Strategy Recommendation Engine schema ready.");
  } catch (error) {
    console.error("Strategy Recommendation migration failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
