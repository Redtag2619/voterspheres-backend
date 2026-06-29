import dotenv from "dotenv";
import { pool } from "../db/pool.js";
import { ensureCoalitionSchema } from "../services/coalitionIntelligence.service.js";

dotenv.config();

async function main() {
  try {
    console.log("Preparing Coalition Intelligence schema...");
    await ensureCoalitionSchema();
    console.log("Coalition Intelligence schema ready.");
  } catch (error) {
    console.error("Coalition Intelligence migration failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
