import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    "node/index": "src/runtime/node/index.ts",
    "web/index": "src/runtime/web/index.ts",
  },
  format: ["esm"],
  platform: "neutral",
  target: "es2022",
  dts: {
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
      from: "../server/artifacts/stagehand-extension.zip",
      to: "dist/node/assets",
    },
    {
      from: "../server/dist",
      to: "dist/node",
      rename: "extension",
    },
  ],
  publint: true,
});
