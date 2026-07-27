import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";
import { assertPublicExtensionArtifact } from "./extensionArtifactPackaging.ts";

const extensionMetadata: unknown = JSON.parse(
  readFileSync(
    new URL("../server/artifacts/stagehand-extension.metadata.json", import.meta.url),
    "utf8",
  ),
);
assertPublicExtensionArtifact(extensionMetadata);

export default defineConfig({
  entry: "src/index.ts",
  format: ["esm"],
  platform: "node",
  target: "node22",
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
      from: "../server/dist",
      to: "dist",
      rename: "extension",
    },
  ],
  publint: true,
});
