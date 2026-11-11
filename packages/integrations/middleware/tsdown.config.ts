import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  // The facade source is bundled in; the SDK (a peer) and zod stay external.
  deps: { neverBundle: ["@browserbasehq/stagehand", /^zod(\/.*)?$/] },
  dts: true,
  outDir: "dist",
});
