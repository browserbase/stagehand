import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const configDir = dirname(fileURLToPath(import.meta.url));
const envDir = resolve(configDir, "tests");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, "");

  return {
    test: {
      environment: "node",
      include: ["tests/**/*.test.ts"],
      env,
      globalSetup: ["./tests/global-setup.stagehand.ts"],
    },
  };
});
