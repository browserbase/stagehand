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
    create(
      params: { file: ReturnType<typeof createReadStream> },
      options?: { maxRetries?: number },
    ): Promise<{ id: string }>;
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
      const extension = await browserbase.extensions.create(
        { file: createReadStream(archivePath) },
        { maxRetries: 0 },
      );
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
/** Browserbase limits uploads per one-minute window, so this always covers one reset. */
const UPLOAD_MAX_TOTAL_WAIT_MS = 65_000;

/** The wait a 429 asks for, in milliseconds. Browserbase sends whole seconds. */
function retryAfterMs(error: object): number | undefined {
  if (!("headers" in error) || !error.headers || typeof error.headers !== "object") {
    return undefined;
  }
  const headers = error.headers as Record<string, unknown>;
  const raw = headers["retry-after"];
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

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
  let attemptsMade = 0;
  let waitedMs = 0;

  for (let attempt = 0; attempt < attempts && uploaded === undefined; attempt += 1) {
    attemptsMade += 1;
    try {
      uploaded = await client.uploadExtension(archivePath);
    } catch (error) {
      lastError = error;
      // Retry an explicit rate-limit rejection only. A transport/server error
      // may follow a successful create whose ID we never received.
      if (!error || typeof error !== "object" || !("status" in error) || error.status !== 429)
        break;
      if (attempt + 1 >= attempts) break;
      const delayMs =
        retryAfterMs(error) ?? UPLOAD_BACKOFF_MS[Math.min(attempt, UPLOAD_BACKOFF_MS.length - 1)]!;
      if (waitedMs + delayMs > UPLOAD_MAX_TOTAL_WAIT_MS) break;
      waitedMs += delayMs;
      await sleep(delayMs);
    }
  }
  if (uploaded === undefined) {
    throw new Error(
      `Failed to upload the Stagehand extension to Browserbase after ${attemptsMade} attempt(s).`,
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

export type ProvisionExtension = (
  client: BrowserbaseExtensionClient,
) => Promise<ProvisionedBrowserbaseExtension>;

type SharedExtension = {
  provisioned: Promise<ProvisionedBrowserbaseExtension>;
  holders: number;
};

const sharedExtensions = new Map<string, SharedExtension>();

/**
 * Launches with the same `key` share one upload instead of each uploading the
 * same archive, which would hit the per-project upload rate limit. The upload
 * is deleted when the last session that holds it cleans up.
 */
export function shareBrowserbaseExtension(
  key: string,
  provision: ProvisionExtension = provisionBrowserbaseExtension,
): ProvisionExtension {
  return async (client) => {
    let shared = sharedExtensions.get(key);
    if (shared === undefined) {
      shared = { provisioned: provision(client), holders: 0 };
      sharedExtensions.set(key, shared);
    }
    const entry = shared;
    const forget = () => {
      if (sharedExtensions.get(key) === entry) sharedExtensions.delete(key);
    };
    entry.holders += 1;

    let provisioned: ProvisionedBrowserbaseExtension;
    try {
      provisioned = await entry.provisioned;
    } catch (error) {
      entry.holders -= 1;
      // A failed upload is not cached, so the next launch uploads again.
      forget();
      throw error;
    }

    let released = false;
    return {
      extensionId: provisioned.extensionId,
      async cleanup() {
        if (!released) {
          released = true;
          entry.holders -= 1;
        }
        if (entry.holders > 0) return;
        forget();
        // Safe to call again after a failed delete: the inner cleanup is idempotent.
        await provisioned.cleanup();
      },
    };
  };
}
