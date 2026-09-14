import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/evals/tests/**/*.test.ts"],
    exclude: ["packages/evals/tests/integration/**"],
    testTimeout: 10_000,
  },
});
