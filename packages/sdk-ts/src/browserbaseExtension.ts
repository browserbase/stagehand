import { readFile } from "node:fs/promises";
import { STAGEHAND_EXTENSION_ARCHIVE_PATH } from "./extensionAssets.js";

const STAGEHAND_EXTENSION_FILE_NAME = "stagehand-extension.zip";

export type BrowserbaseExtensionClient = {
  uploadExtension(archive: Blob): Promise<{ id: string }>;
  deleteExtension(extensionId: string): Promise<void>;
};

export type BrowserbaseExtensionArchiveLoader = (archivePath: string) => Promise<Blob>;

export type ProvisionedBrowserbaseExtension = {
  extensionId: string;
  cleanup(): Promise<void>;
};

export async function loadStagehandExtensionArchive(
  archivePath = STAGEHAND_EXTENSION_ARCHIVE_PATH,
): Promise<Blob> {
  const bytes = await readFile(archivePath);
  if (bytes.byteLength === 0) {
    throw new Error("The Stagehand extension archive is empty");
  }
  return new Blob([bytes], { type: "application/zip" });
}

export async function provisionBrowserbaseExtension(
  client: BrowserbaseExtensionClient,
  archivePath = STAGEHAND_EXTENSION_ARCHIVE_PATH,
  loadArchive: BrowserbaseExtensionArchiveLoader = loadStagehandExtensionArchive,
): Promise<ProvisionedBrowserbaseExtension> {
  let uploaded: { id: string };

  try {
    uploaded = await client.uploadExtension(await loadArchive(archivePath));
  } catch (error) {
    throw new Error("Failed to upload the Stagehand extension to Browserbase", { cause: error });
  }

  const extensionId = uploaded.id.trim();
  if (extensionId.length === 0) {
    throw new Error("Browserbase extension upload returned an empty extension ID");
  }

  let cleaned = false;
  return {
    extensionId,
    async cleanup() {
      if (cleaned) return;
      await client.deleteExtension(extensionId);
      cleaned = true;
    },
  };
}

export function stagehandExtensionFileName(): string {
  return STAGEHAND_EXTENSION_FILE_NAME;
}
