import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { stagehand: "extensions/stagehand.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  // Core is private. Bundle its implementation, while preserving the SDK's assets.
  deps: { alwaysBundle: [/@browserbasehq\/stagehand-integrations/] },
  sourcemap: true,
  outDir: "dist",
});
