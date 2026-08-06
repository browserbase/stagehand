import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    "codemode/stdio-server": "src/codemode/stdio-server.ts",
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
