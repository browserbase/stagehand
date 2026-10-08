import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/index.ts",
  format: ["esm"],
  platform: "node",
  target: "node22",
  dts: {
    eager: true,
    sourcemap: true,
  },
  sourcemap: true,
  outDir: "dist",
  deps: {
    onlyBundle: [
      "camelcase",
      "camelcase-keys",
      "change-case",
      "map-obj",
      "quick-lru",
      "snakecase-keys",
    ],
  },
  copy: [
    {
      from: "../extension/artifacts/stagehand-extension.zip",
      to: "dist/assets",
    },
    {
      from: "../extension/dist",
      to: "dist",
      rename: "extension",
    },
  ],
  publint: true,
});
