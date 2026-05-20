import "dotenv/config";

import {
  importDemoConsultants,
} from "../services/consultantImport.service.js";

async function run() {
  try {
    const result = await importDemoConsultants();

    console.log("✅ Consultant import complete", result);

    process.exit(0);
  } catch (error) {
    console.error("❌ Consultant import failed", error);
    process.exit(1);
  }
}

run();
________________________________________
