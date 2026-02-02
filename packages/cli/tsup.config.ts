import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node20",
  clean: true,
  shims: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  // Bundle everything possible, only externalize what truly can't be bundled
  noExternal: [/^\.\.\/core/],
  external: [
    // Browser automation - user must install playwright to use the CLI
    "playwright",
    "playwright-core",
    // CJS packages with dynamic requires that break in ESM bundles
    "pino",
    "pino-pretty",
    "ws",
    "dotenv",
  ],
});
