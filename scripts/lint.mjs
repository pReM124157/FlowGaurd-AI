import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const files = execFileSync("find", ["src", "test", "scripts", "ui", "-type", "f"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);

const banned = [
  new RegExp("Access-Control-Allow-Origin:\\s*\\*", "i"),
  new RegExp("local" + "Storage", "i"),
  new RegExp("session" + "Storage", "i"),
  new RegExp("console\\.log\\(.*password", "i"),
  new RegExp("console\\.log\\(.*secret", "i"),
];
const requiredUiStates = ["ACTUAL", "USER_DECLARED", "PENDING", "FORECAST", "PREDICTED", "SIMULATED", "DEMO DATA"];
let failed = false;

for (const file of files) {
  const content = await readFile(file, "utf8");
  for (const pattern of banned) {
    if (file === "scripts/lint.mjs") continue;
    if (pattern.test(content)) {
      console.error(`Lint failed: banned pattern ${pattern} in ${file}`);
      failed = true;
    }
  }
  if (file.endsWith(".ts") && content.includes("catch (Exception)")) {
    console.error(`Lint failed: broad catch marker in ${file}`);
    failed = true;
  }
}

const app = await readFile("ui/app.js", "utf8");
for (const label of requiredUiStates) {
  if (!app.includes(label)) {
    console.error(`Lint failed: UI state label missing ${label}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("Lint checks passed");
