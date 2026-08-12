import { createReadStream } from "node:fs";
import Browserbase from "@browserbasehq/sdk";
import { STAGEHAND_EXTENSION_ARCHIVE_PATH } from "./extensionAssets.js";

export type BrowserbaseExtensionClient = {
  uploadExtension(archivePath: string): Promise<{ id: string }>;
  deleteExtension(extensionId: string): Promise<void>;
};

export type ProvisionedBrowserbaseExtension = {
  extensionId: string;
  cleanup(): Promise<void>;
};

export type BrowserbaseExtensionSdk = {
  extensions: {
    create(params: { file: ReturnType<typeof createReadStream> }): Promise<{ id: string }>;
    delete(
      extensionId: string,
      options?: { headers?: Record<string, string | null> },
    ): Promise<void>;
  };
};

type BrowserbaseSdkFactory = (apiKey: string) => BrowserbaseExtensionSdk;

export function createBrowserbaseExtensionClient(
  apiKey: string,
  createSdk: BrowserbaseSdkFactory = (key) => new Browserbase({ apiKey: key }),
): BrowserbaseExtensionClient {
  const browserbase = createSdk(apiKey);
  return {
    async uploadExtension(archivePath) {
      const extension = await browserbase.extensions.create({
        file: createReadStream(archivePath),
      });
      return { id: extension.id };
    },
    async deleteExtension(extensionId) {
      await browserbase.extensions.delete(extensionId, {
        headers: { "Content-Type": null },
      });
    },
  };
}

export async function provisionBrowserbaseExtension(
  client: BrowserbaseExtensionClient,
  archivePath = STAGEHAND_EXTENSION_ARCHIVE_PATH,
): Promise<ProvisionedBrowserbaseExtension> {
  let uploaded: { id: string };

  try {
    uploaded = await client.uploadExtension(archivePath);
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
