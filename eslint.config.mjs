import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  { files: ["**/*.{js,mjs,cjs,ts}"] },
  { languageOptions: { globals: globals.browser } },
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "packages/core/lib/dom/build/**",
      "packages/core/lib/v3/dom/build/**",
      "**/*.config.js",
      "**/*.config.mjs",
      ".browserbase/**",
      "**/.browserbase/**",
      "**/*.json",
      "stainless.yml",
      "packages/server/openapi.v3.yaml",
    ],
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
];
