import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { getConfigDir } from "../../eventStore.js";

export async function persistAgentScreenshotArtifact(
  sessionId: string,
  screenshot: Buffer,
): Promise<string | undefined> {
  try {
    const configDir = getConfigDir();
    const rootDir = configDir || path.join(os.tmpdir(), "stagehand");
    const screenshotDir = path.join(
      rootDir,
      "sessions",
      sessionId,
      "artifacts",
      "agent-screenshots",
    );
    const screenshotPath = path.join(
      screenshotDir,
      `${Date.now()}-${randomUUID()}.png`,
    );

    await fs.promises.mkdir(screenshotDir, { recursive: true });
    await fs.promises.writeFile(screenshotPath, screenshot);

    return screenshotPath;
  } catch {
    return undefined;
  }
}
