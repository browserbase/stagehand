import { defineConfig } from "vitest/config";
import { instrumentedDecoratorBuild } from "./packages/extension/instrumentedDecoratorBuild.ts";

export default defineConfig({
  plugins: [instrumentedDecoratorBuild()],
  test: {
    include: ["packages/sdk-ts/tests/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
