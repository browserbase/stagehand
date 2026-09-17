import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/integrations/core/integration/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
