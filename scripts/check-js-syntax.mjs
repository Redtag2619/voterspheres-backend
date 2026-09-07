import { spawnSync } from "node:child_process"; 
import { readdirSync } from "node:fs";
import { join } from "node:path";

const roots = ["middleware", "routes", "controllers", "services", "repositories", "jobs", "scripts"];
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(m?js)$/.test(entry.name) && !entry.name.endsWith(".syntax-backup.js")) files.push(path);
  }
}
for (const root of roots) walk(root);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax validated: ${files.length} files`);
