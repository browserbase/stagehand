import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    "codemode/stdio-server": "src/codemode/stdio-server.ts",
    "facade/index": "src/facade/index.ts",
    "facade/stdio-server": "src/facade/stdio-server.ts",
    "harness/index": "src/harness/index.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  dts: {
    sourcemap: true,
  },
  sourcemap: true,
  outDir: "dist",
});
