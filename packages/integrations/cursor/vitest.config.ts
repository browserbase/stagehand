import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
});
