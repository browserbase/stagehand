import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";
import {
  assertExtensionArtifactsMatch,
  assertPublicExtensionArtifact,
} from "./extensionArtifactPackaging.ts";

const metadataUrl = new URL(
  "../extension/artifacts/stagehand-extension.metadata.json",
  import.meta.url,
);
const archiveUrl = new URL("../extension/artifacts/stagehand-extension.zip", import.meta.url);
const extensionUrl = new URL("../extension/dist", import.meta.url);
const metadata = assertPublicExtensionArtifact(
  JSON.parse(readFileSync(metadataUrl, "utf8")) as unknown,
);
await assertExtensionArtifactsMatch(
  metadata,
  fileURLToPath(archiveUrl),
  fileURLToPath(extensionUrl),
);

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
