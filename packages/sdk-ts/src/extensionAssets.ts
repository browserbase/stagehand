import { readFile } from "node:fs/promises";
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

export const STAGEHAND_EXTENSION_BUILD_INFO_PATH =
  nonEmpty(process.env.STAGEHAND_EXTENSION_BUILD_INFO_PATH) ??
  fileURLToPath(new URL("dist/assets/extension-build.json", packageRoot));

/**
 * Returns the ZIP archive of the extension bundled with this SDK.
 * Save or upload the bytes directly, or extract it to a directory for Chrome's
 * Load unpacked option. No browser session is required.
 */
export async function getExtensionArchive(): Promise<Uint8Array> {
  return readFile(STAGEHAND_EXTENSION_ARCHIVE_PATH);
}

// Internal: not exported from the package entry point.
export async function getExtensionFingerprint(): Promise<string> {
  const buildInfo = STAGEHAND_EXTENSION_BUILD_INFO_PATH;
  const contents = await readFile(buildInfo, "utf8").catch((error: unknown) => {
    throw new Error(`Stagehand extension build file could not be read at ${buildInfo}`, {
      cause: error,
    });
  });
  let fingerprint: unknown;
  try {
    fingerprint = (JSON.parse(contents) as { fingerprint?: unknown } | null)?.fingerprint;
  } catch {
    fingerprint = undefined;
  }
  if (typeof fingerprint !== "string") {
    throw new Error(`${buildInfo} does not contain an extension fingerprint`);
  }
  return fingerprint;
}
