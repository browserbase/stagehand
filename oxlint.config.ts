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
      files: [
        "packages/extension/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
        "packages/shared-object-model/src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      ],
      rules: { "stagehand/no-node-globals": "error" },
    },
    {
      files: [
        "packages/{extension,shared-object-model}/**/tests/**",
        "packages/{extension,shared-object-model}/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
        "packages/extension/{vite.config,instrumentedDecoratorBuild}.{js,mjs,cjs,ts,mts,cts}",
        "packages/extension/{dist,artifacts,.turbo}/**",
      ],
      rules: { "stagehand/no-node-globals": "off" },
    },
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
