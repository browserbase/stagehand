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

/**
 * Upload attempts and the pause between them. Many Stagehand sessions
 * launching at once each upload the same archive; Browserbase rejects part
 * of such a burst, and one rejection used to kill the session for good.
 */
const UPLOAD_ATTEMPTS = 4;
const UPLOAD_BACKOFF_MS = [500, 1500, 4000];

export type ProvisionBrowserbaseExtensionOptions = {
  attempts?: number;
  /** Test seam; defaults to a real delay. */
  sleep?: (ms: number) => Promise<void>;
};

export async function provisionBrowserbaseExtension(
  client: BrowserbaseExtensionClient,
  archivePath = STAGEHAND_EXTENSION_ARCHIVE_PATH,
  options: ProvisionBrowserbaseExtensionOptions = {},
): Promise<ProvisionedBrowserbaseExtension> {
  const attempts = options.attempts ?? UPLOAD_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > UPLOAD_ATTEMPTS) {
    throw new Error(`attempts must be an integer between 1 and ${UPLOAD_ATTEMPTS}`);
  }
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let uploaded: { id: string } | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts && uploaded === undefined; attempt += 1) {
    try {
      uploaded = await client.uploadExtension(archivePath);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await sleep(UPLOAD_BACKOFF_MS[Math.min(attempt, UPLOAD_BACKOFF_MS.length - 1)]!);
      }
    }
  }
  if (uploaded === undefined) {
    throw new Error(
      `Failed to upload the Stagehand extension to Browserbase after ${attempts} attempt(s).`,
      { cause: lastError },
    );
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
