import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 60000,
    hookTimeout: 60000,
    include: ["tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "tests/browser/**"],
    pool: "forks",
    fileParallelism: false,
  },
});
