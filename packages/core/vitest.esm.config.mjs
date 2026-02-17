import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@browserbasehq/stagehand": path.join(rootDir, "dist", "esm", "index.js"),
    },
  },
  test: {
    environment: "node",
    include: ["**/dist/esm/tests/**/*.test.js"],
  },
});
