import dotenv from "dotenv";
import { ensureInfluenceSchema } from "../services/influence.service.js";
import { pool } from "../db/pool.js";

dotenv.config();

async function main() {
  try {
    console.log("Preparing Influence Engine schema...");
    await ensureInfluenceSchema();
    console.log("Influence Engine schema ready.");
  } catch (error) {
    console.error("Influence Engine migration failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
