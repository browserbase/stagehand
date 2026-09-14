import { fileURLToPath } from "node:url";

const packageRoot = new URL("../", import.meta.url);

// Env overrides exist for bundlers (nitro, eve dev's authored-module
// compiler) that inline this module and re-anchor import.meta.url away from
// the installed package, leaving the derived paths pointing at files the
// bundle does not carry.
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const STAGEHAND_EXTENSION_ARCHIVE_PATH =
  nonEmpty(process.env.STAGEHAND_EXTENSION_ARCHIVE_PATH) ??
  fileURLToPath(new URL("dist/assets/stagehand-extension.zip", packageRoot));

export const STAGEHAND_EXTENSION_DIRECTORY_PATH =
  nonEmpty(process.env.STAGEHAND_EXTENSION_DIRECTORY_PATH) ??
  fileURLToPath(new URL("dist/extension/", packageRoot));
