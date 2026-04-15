import "dotenv/config";
import { syncFundraisingFromFec } from "../services/fec.service.js";

async function main() {
  const cycleArg = process.argv[2];
  const cycle = cycleArg ? Number(cycleArg) : undefined;

  const result = await syncFundraisingFromFec({ cycle });

  console.log("✅ FEC sync complete");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("❌ FEC sync failed");
  console.error(error);
  process.exit(1);
});
