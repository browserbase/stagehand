import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
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
