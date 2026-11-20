import { toFile } from "@browserbasehq/sdk";
import { getExtensionArchive } from "@browserbasehq/stagehand";

import type { createBrowserbaseClient } from "./api.js";

export type BrowserbaseClientLike = ReturnType<typeof createBrowserbaseClient>;

/**
 * Upload attempts and backoff for 429 rate-limit retries.
 * Matches the SDK's provisionBrowserbaseExtension pattern.
 */
const UPLOAD_ATTEMPTS = 4;
const UPLOAD_BACKOFF_MS = [500, 1500, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload the bundled Stagehand extension to Browserbase and return its ID.
 * This is used by `sessions create` to automatically provision the extension
 * so that later `--cdp` attaches find a compatible runtime.
 *
 * Uses maxRetries: 0 to prevent SDK auto-retries (which could create duplicates
 * if the upload succeeds but the response is lost), but manually retries 429
 * rate-limit responses with bounded backoff.
 */
export async function uploadStagehandExtension(
  client: BrowserbaseClientLike,
): Promise<{ extensionId: string }> {
  const archive = await getExtensionArchive();

  let uploaded: { id: string } | undefined;
  let lastError: unknown;
  let attemptsMade = 0;

  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS && uploaded === undefined; attempt += 1) {
    attemptsMade += 1;
    try {
      const file = await toFile(archive, "stagehand-extension.zip", {
        type: "application/zip",
      });
      // maxRetries: 0 prevents duplicate uploads if the response is lost but
      // the upload succeeded - we handle 429 retries manually below.
      uploaded = await client.extensions.create({ file }, { maxRetries: 0 });
    } catch (error) {
      lastError = error;
      // Retry only on explicit 429 rate-limit. Other errors (transport, server)
      // may follow a successful create whose ID we never received.
      if (!error || typeof error !== "object" || !("status" in error) || error.status !== 429) {
        break;
      }
      if (attempt + 1 < UPLOAD_ATTEMPTS) {
        await sleep(UPLOAD_BACKOFF_MS[Math.min(attempt, UPLOAD_BACKOFF_MS.length - 1)]!);
      }
    }
  }

  if (uploaded === undefined) {
    // Re-throw the original error to preserve its type (e.g., APIError) for
    // telemetry classification in withBrowserbaseApi. The retry context is lost
    // but correct HTTP status/result code tracking is more important.
    if (lastError) {
      throw lastError;
    }
    throw new Error(
      `Failed to upload the Stagehand extension to Browserbase after ${attemptsMade} attempt(s).`,
    );
  }

  const extensionId = uploaded.id?.trim();
  if (!extensionId) {
    throw new Error("Browserbase extension upload returned an empty extension ID");
  }

  return { extensionId };
}
