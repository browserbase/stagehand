import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/v3/tests/unit/**/*.test.ts"],
  },
});
