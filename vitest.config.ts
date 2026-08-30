import { defineConfig } from "vitest/config";
import { instrumentedDecoratorBuild } from "./packages/extension/instrumentedDecoratorBuild.ts";

export default defineConfig({
  plugins: [instrumentedDecoratorBuild()],
  test: {
    testTimeout: 15_000,
    include: [
      "packages/protocol/tests/**/*.test.ts",
      "packages/protocol/json-rpc/tests/**/*.test.ts",
      "packages/docs/tests/**/*.test.ts",
      "packages/evals/tests/**/*.test.ts",
      "packages/integrations/core/tests/**/*.test.ts",
      "packages/integrations/claude-agent-sdk/tests/**/*.test.ts",
      "packages/integrations/codex-sdk/tests/**/*.test.ts",
      "packages/extension/tests/**/*.test.ts",
      "packages/extension/llm/**/*.test.ts",
      "packages/sdk-ts/tests/**/*.test.ts",
      "packages/extension/understudy/**/*.test.ts",
      "rules/ast-grep/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    // Integration specs launch real Chrome and are owned solely by
    // vitest.integration.config.ts, driven through `pnpm run test:integration`. Without this
    // they would also be swept up by the packages/sdk-ts/tests/** glob above and run as part
    // of the cacheable unit suite.
    exclude: ["**/node_modules/**", "**/dist/**", "packages/sdk-ts/tests/integration/**"],
  },
});
