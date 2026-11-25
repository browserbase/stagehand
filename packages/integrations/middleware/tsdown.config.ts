import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  deps: { neverBundle: ["@browserbasehq/stagehand", /^zod(\/.*)?$/] },
  dts: true,
  outDir: "dist",
});
