import { defineConfig } from "tsdown";

// Builds only the private evals harness driver (harness/) into dist-harness/, which is outside
// "files" and absent from publishConfig.exports, so the published @browserbasehq/eve tarball
// is unchanged. The published extension is built separately by `eve extension build`.
// Run via `build:harness` (not `build`), so `prepack` never needs a built
// @browserbasehq/stagehand-integrations.
export default defineConfig({
  entry: {
    index: "harness/index.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  dts: {
    sourcemap: true,
  },
  sourcemap: true,
  outDir: "dist-harness",
  // Keep the harness runtime deps external, as the former private eve harness package did
  // (they were its dependencies there; here they are devDependencies, which tsdown would inline).
  deps: {
    neverBundle: [
      /^@browserbasehq\/stagehand-integrations(\/.*)?$/,
      /^@ai-sdk\//,
      /^@modelcontextprotocol\//,
      /^ai(\/.*)?$/,
      /^eve(\/.*)?$/,
    ],
  },
});
