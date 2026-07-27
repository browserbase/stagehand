import { defineConfig } from "vitest/config";
import { instrumentedDecoratorBuild } from "./packages/server/instrumentedDecoratorBuild.ts";

export default defineConfig({
  plugins: [instrumentedDecoratorBuild()],
  test: {
    include: [
      "packages/protocol/tests/**/*.test.ts",
      "packages/protocol/json-rpc/tests/**/*.test.ts",
      // TODO(docs-migration): Re-enable when the docs conformance tests return.
      // "packages/docs/tests/**/*.test.ts",
      "packages/server/tests/**/*.test.ts",
      "packages/sdk-ts/tests/**/*.test.ts",
      "packages/server/understudy/**/*.test.ts",
      "rules/ast-grep/**/*.test.ts",
      "scripts/release/**/*.test.ts",
    ],
  },
});
