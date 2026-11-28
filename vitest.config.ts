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
      "packages/integrations/middleware/tests/**/*.test.ts",
      "packages/integrations/claude-cua-sdk/tests/**/*.test.ts",
      "packages/integrations/gemini-cua-sdk/tests/**/*.test.ts",
      "packages/integrations/pi-sdk/tests/**/*.test.ts",
      "packages/integrations/deepagents-sdk/tests/**/*.test.ts",
      "packages/integrations/fx/tests/**/*.test.ts",
      "packages/extension/tests/**/*.test.ts",
      "packages/extension/clients/**/*.test.ts",
      "packages/sdk-ts/tests/**/*.test.ts",
      "packages/shared/browser-api/tests/**/*.test.ts",
      "packages/extension/understudy/**/*.test.ts",
      "rules/ast-grep/**/*.test.ts",
      "rules/oxlint/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "packages/sdk-ts/tests/integration/**"],
  },
});
