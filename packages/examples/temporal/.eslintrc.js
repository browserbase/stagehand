const { builtinModules } = require("module");

const ALLOWED_NODE_BUILTINS = new Set(["assert"]);

module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  plugins: ["@typescript-eslint", "deprecation"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  rules: {
    // recommended for safety
    "@typescript-eslint/no-floating-promises": "error", // forgetting to await Activities and Workflow APIs is bad
    "deprecation/deprecation": "warn",

    // code style preference
    "object-shorthand": ["error", "always"],

    // relaxed rules, for convenience
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      },
    ],
    "@typescript-eslint/no-explicit-any": "off",
  },
  overrides: [
    {
      files: ["src/workflows.ts", "src/workflows-*.ts", "src/workflows/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          ...builtinModules
            .filter((m) => !ALLOWED_NODE_BUILTINS.has(m))
            .flatMap((m) => [m, `node:${m}`]),
        ],
      },
    },
  ],
};
