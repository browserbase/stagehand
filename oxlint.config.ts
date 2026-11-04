import { defineConfig } from "oxlint";
import { cliConfig } from "./rules/oxlint/cli-config.ts";
import { stagehandRuleConfig } from "./rules/oxlint/stagehand-plugin.ts";

export default defineConfig({
  jsPlugins: [{ name: "stagehand", specifier: "./rules/oxlint/stagehand-plugin.ts" }],
  rules: {
    "no-console": "error",
    "typescript/no-deprecated": "warn",
    ...stagehandRuleConfig,
  },
  overrides: [
    ...cliConfig.overrides!,
    {
      files: ["packages/evals/**/*.ts"],
      rules: {
        "no-console": "off",
      },
    },
    {
      files: ["packages/sdk-ts/examples/**/*.ts", "packages/examples/**/*.ts"],
      rules: {
        "no-console": "off",
      },
    },
    {
      files: ["packages/docs/scripts/**/*.js"],
      rules: {
        "no-console": "off",
      },
    },
  ],
  ignorePatterns: cliConfig.ignorePatterns,
  options: { typeAware: true },
});
