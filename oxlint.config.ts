import { defineConfig } from "oxlint";
import { stagehandRuleConfig } from "./rules/oxlint/stagehand-plugin.ts";

export default defineConfig({
  jsPlugins: [{ name: "stagehand", specifier: "./rules/oxlint/stagehand-plugin.ts" }],
  rules: {
    "no-console": "error",
    "typescript/no-deprecated": "warn",
    ...stagehandRuleConfig,
  },
  overrides: [
    {
      files: ["packages/cli/**/*.{js,ts}"],
      rules: {
        "no-console": "off",
        "stagehand/no-renamed-imports": "off",
      },
    },
    {
      files: ["packages/evals/**/*.ts"],
      rules: {
        "no-console": "off",
      },
    },
    {
      files: ["packages/sdk-ts/examples/**/*.ts"],
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
  options: { typeAware: true },
});
