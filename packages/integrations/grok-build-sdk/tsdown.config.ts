import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  deps: { neverBundle: ["@browserbasehq/stagehand-integrations"] },
  outputOptions: { minify: false },
});
