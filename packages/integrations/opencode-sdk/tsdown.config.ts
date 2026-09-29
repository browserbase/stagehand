import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", worker: "src/worker.ts", "mcp-wrapper": "src/mcp-wrapper.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: ["@browserbasehq/stagehand-integrations", "@opencode/sdk", "@opencode/plugin"],
  },
  outputOptions: { minify: false },
});
