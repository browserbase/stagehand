import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    driver: "src/driver.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  dts: {
    sourcemap: true,
  },
  sourcemap: true,
  // mastracode is a dependency (never bundled) and the driver imports it by
  // name at runtime, in its own process.
  outDir: "dist",
});
