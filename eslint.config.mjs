import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";

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
  {
    plugins: {
      security,
    },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "security/detect-eval-with-expression": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='Function']",
          message: "Dynamic function construction is prohibited.",
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: "Dynamic function construction is prohibited.",
        },
        {
          selector:
            "CallExpression[callee.object.name='window'][callee.property.name='Function']",
          message:
            "Dynamic function construction via window.Function is prohibited.",
        },
        {
          selector:
            "CallExpression[callee.object.name='globalThis'][callee.property.name='Function']",
          message:
            "Dynamic function construction via globalThis.Function is prohibited.",
        },
      ],
    },
  },
];
