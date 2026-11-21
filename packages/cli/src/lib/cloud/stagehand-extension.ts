import { toFile } from "@browserbasehq/sdk";
import { getExtensionArchive } from "@browserbasehq/stagehand";

import type { createBrowserbaseClient } from "./api.js";

export type BrowserbaseClientLike = ReturnType<typeof createBrowserbaseClient>;

/**
 * Upload attempts and backoff for 429 rate-limit retries.
 * Mirrors the SDK's provisionBrowserbaseExtension pattern. The CLI cannot
 * import SDK internals directly because it depends on the published SDK
 * (version 4.4.0), not `workspace:*`, and the workspace config has
 * `linkWorkspacePackages: false`. Each session-create uploads a new extension.
 */
const UPLOAD_ATTEMPTS = 4;
const UPLOAD_BACKOFF_MS = [500, 1500, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload the bundled Stagehand extension to Browserbase and return its ID.
 * Returns undefined on failure instead of throwing, allowing callers to
 * continue without the extension.
 */
export async function uploadStagehandExtension(
  client: BrowserbaseClientLike,
): Promise<{ extensionId: string } | undefined> {
  let archive: Uint8Array;
  try {
    archive = await getExtensionArchive();
  } catch {
    console.error("Warning: Stagehand extension archive not available");
    return undefined;
  }

  let uploaded: { id: string } | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS && uploaded === undefined; attempt += 1) {
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
    // Sanitize error message - don't expose Browserbase API response details
    const status =
      lastError && typeof lastError === "object" && "status" in lastError
        ? ` (HTTP ${lastError.status})`
        : "";
    console.error(`Warning: Stagehand extension upload failed${status}`);
    return undefined;
  }

  const extensionId = uploaded.id?.trim();
  if (!extensionId) {
    console.error("Warning: Stagehand extension upload returned an empty extension ID");
    return undefined;
  }

  return { extensionId };
}
