import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@browserbasehq/stagehand": path.join(
        rootDir,
        "..",
        "core",
        "lib",
        "v3",
        "index.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.ts",
      "**/dist/esm/tests/unit/**/*.test.js",
    ],
  },
});
