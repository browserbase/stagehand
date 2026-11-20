import { toFile } from "@browserbasehq/sdk";
import { getExtensionArchive } from "@browserbasehq/stagehand";

import type { createBrowserbaseClient } from "./api.js";

export type BrowserbaseClientLike = ReturnType<typeof createBrowserbaseClient>;

/**
 * Upload the bundled Stagehand extension to Browserbase and return its ID.
 * This is used by `sessions create` to automatically provision the extension
 * so that later `--cdp` attaches find a compatible runtime.
 */
export async function uploadStagehandExtension(
  client: BrowserbaseClientLike,
): Promise<{ extensionId: string }> {
  const archive = await getExtensionArchive();
  const file = await toFile(archive, "stagehand-extension.zip", {
    type: "application/zip",
  });

  const result = await client.extensions.create({ file });
  const extensionId = result.id?.trim();
  if (!extensionId) {
    throw new Error("Browserbase extension upload returned an empty extension ID");
  }

  return { extensionId };
}
