import { defineConfig } from "vite-plus";
import { instrumentedDecoratorBuild } from "./packages/server/instrumentedDecoratorBuild.ts";
import { stagehandRuleConfig } from "./rules/oxlint/stagehand-plugin.ts";

export default defineConfig({
  plugins: [instrumentedDecoratorBuild()],
  fmt: {},
  lint: {
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "stagehand", specifier: "./rules/oxlint/stagehand-plugin.ts" },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "no-console": "error",
      "typescript/no-deprecated": "warn",
      ...stagehandRuleConfig,
    },
    overrides: [
      {
        files: ["packages/sdk-ts/examples/**/*.ts"],
        rules: {
          "no-console": "off",
        },
      },
    ],
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
  test: {
    include: [
      "packages/protocol/tests/**/*.test.ts",
      "packages/protocol/json-rpc/tests/**/*.test.ts",
      "packages/docs/tests/**/*.test.ts",
      "packages/server/tests/**/*.test.ts",
      "packages/sdk-ts/tests/**/*.test.ts",
      "packages/server/understudy/**/*.test.ts",
      "rules/ast-grep/**/*.test.ts",
    ],
    typecheck: {
      enabled: true,
      include: [
        "packages/protocol/tests/**/*.test.ts",
        "packages/protocol/tests/**/*.test-d.ts",
        "packages/protocol/json-rpc/tests/**/*.test.ts",
        "packages/protocol/json-rpc/tests/**/*.test-d.ts",
        "packages/docs/tests/**/*.test.ts",
        "packages/server/tests/**/*.test.ts",
        "packages/sdk-ts/tests/**/*.test.ts",
        "packages/sdk-ts/tests/**/*.test-d.ts",
        "packages/server/understudy/**/*.test.ts",
        "packages/server/llm/**/*.test-d.ts",
        "rules/ast-grep/**/*.test.ts",
      ],
      tsconfig: "packages/protocol/tsconfig.json",
    },
  },
});
