import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The unpublished v4 SDK (linked raw TS in the sibling v4-spike checkout)
      // cannot be imported at runtime under vitest and is not what unit tests
      // exercise. Redirect it to a lightweight stub so harness-mechanics tests
      // that transitively import it (initV4, v4_code) can load. See the stub.
      "@browserbasehq/stagehand-v4-spike-sdk-ts": fileURLToPath(
        new URL("./tests/stubs/v4-sdk-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**"],
    testTimeout: 10_000,
  },
});
