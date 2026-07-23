import { fileURLToPath } from "node:url";

const packageRoot = new URL("../", import.meta.url);

export const STAGEHAND_EXTENSION_ARCHIVE_PATH = fileURLToPath(
  new URL("dist/assets/stagehand-extension.zip", packageRoot),
);

export const STAGEHAND_EXTENSION_DIRECTORY_PATH = fileURLToPath(
  new URL("dist/extension/", packageRoot),
);
