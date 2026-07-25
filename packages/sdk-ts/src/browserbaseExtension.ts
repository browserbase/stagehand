import { stagehandExtensionArchiveDataUrl } from "./generated/stagehandExtensionArchive.generated.js";

const STAGEHAND_EXTENSION_FILE_NAME = "stagehand-extension.zip";

export type BrowserbaseExtensionClient = {
  uploadExtension(archive: Blob): Promise<{ id: string }>;
  deleteExtension(extensionId: string): Promise<void>;
};

export type BrowserbaseExtensionArchiveLoader = () => Promise<Blob>;

export type ProvisionedBrowserbaseExtension = {
  extensionId: string;
  cleanup(): Promise<void>;
};

type ExtensionArchiveLoaderDependencies = {
  fetch?: typeof globalThis.fetch;
};

export async function loadStagehandExtensionArchive(
  archiveUrl: string | URL = stagehandExtensionArchiveDataUrl,
  dependencies: ExtensionArchiveLoaderDependencies = {},
): Promise<Blob> {
  const fetchArchive = dependencies.fetch ?? globalThis.fetch;
  const response = await fetchArchive(archiveUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to load the Stagehand extension archive: ${response.status} ${response.statusText}`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  if (bytes.byteLength === 0) {
    throw new Error("The Stagehand extension archive is empty");
  }

  const copiedBytes = Uint8Array.from(bytes);
  return new Blob([copiedBytes.buffer], { type: "application/zip" });
}

export async function provisionBrowserbaseExtension(
  client: BrowserbaseExtensionClient,
  loadArchive: BrowserbaseExtensionArchiveLoader = loadStagehandExtensionArchive,
): Promise<ProvisionedBrowserbaseExtension> {
  let uploaded: { id: string };

  try {
    uploaded = await client.uploadExtension(await loadArchive());
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
