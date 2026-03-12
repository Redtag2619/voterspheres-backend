import dotenv from "dotenv";
import { rebuildForecastSnapshots } from "./forecastRebuild.job.js";

dotenv.config();

let forecastJobHandle = null;

export function startForecastScheduler() {
  const disabled =
    String(process.env.DISABLE_FORECAST_REBUILD_JOB || "false") === "true";

  if (disabled) {
    console.log("⏸ Forecast rebuild job disabled");
    return;
  }

  const intervalMs = Number(process.env.FORECAST_REBUILD_INTERVAL_MS || 3600000);

  if (forecastJobHandle) {
    clearInterval(forecastJobHandle);
  }

  forecastJobHandle = setInterval(async () => {
    try {
      const result = await rebuildForecastSnapshots();
      console.log("✅ Forecast rebuild completed:", result);
    } catch (error) {
      console.error("❌ Forecast rebuild failed:", error.message || error);
    }
  }, intervalMs);

  console.log(`⏱ Forecast rebuild scheduled every ${intervalMs}ms`);
}
