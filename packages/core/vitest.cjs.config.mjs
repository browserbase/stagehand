import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@browserbasehq/stagehand": path.join(rootDir, "dist", "cjs", "index.js"),
    },
  },
  test: {
    environment: "node",
    include: ["**/dist/cjs/tests/unit/**/*.test.js"],
  },
});
