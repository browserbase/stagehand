import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { server: "../core/src/facade/stdio-server.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  sourcemap: true,
  outDir: "dist",
});
