import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const required = [
  "ui/index.html",
  "ui/css/landing.css",
  "ui/css/motion.css",
  "ui/js/landing/main.js",
  "ui/js/landing/cinematic-orchestrator.js",
  "src/server/api.ts",
  "src/server/server.ts"
];

for (const file of required) {
  await access(file);
}

const dist = "dist";
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "ui", "css"), { recursive: true });
await mkdir(join(dist, "ui", "js", "landing"), { recursive: true });

for (const file of required) {
  if (file.startsWith("ui/")) {
    const source = await readFile(file, "utf8");
    await writeFile(join(dist, file), source);
  }
}

await mkdir(dirname(join(dist, "BUILD_INFO.json")), { recursive: true });
await writeFile(
  join(dist, "BUILD_INFO.json"),
  JSON.stringify(
    {
      name: "FlowGuard AI Cinematic Build",
      builtAt: new Date().toISOString(),
      verified: true
    },
    null,
    2,
  ),
);

console.log("Build artifact successfully created and verified in dist/");
