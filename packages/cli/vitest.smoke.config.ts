import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/browser/**/*.test.ts"],
    testTimeout: 240_000,
    hookTimeout: 60_000,
    pool: "forks",
    fileParallelism: false,
  },
});
