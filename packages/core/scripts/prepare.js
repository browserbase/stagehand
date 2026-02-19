import { spawnSync } from "node:child_process";

const isCi =
  process.env.CI === "true" ||
  process.env.CI === "1" ||
  process.env.SKIP_PREPARE === "1";

if (isCi) {
  console.log("Skipping prepare script in CI.");
  process.exit(0);
}

const result = spawnSync("pnpm", ["run", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
