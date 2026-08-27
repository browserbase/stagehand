import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "out/**",
      ".cache/**",
      ".browserbase/**",
      "**/.browserbase/**",
      "*.tgz",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
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
      "preserve-caught-error": "error",
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
            "CallExpression[callee.object.name='globalThis'][callee.property.name='Function']",
          message:
            "Dynamic function construction via globalThis.Function is prohibited.",
        },
      ],
    },
  },
];
