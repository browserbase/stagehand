import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let artifactDirectory: string | undefined;
let screenshotNumber = 0;

export async function writeScreenshotArtifact(image: {
  data: string;
  mimeType: string;
}): Promise<{ path: string; mimeType: string }> {
  artifactDirectory ??= await mkdtemp(path.join(os.tmpdir(), "stagehand-flue-"));
  screenshotNumber += 1;
  const extension = image.mimeType === "image/jpeg" ? "jpg" : "png";
  const screenshotPath = path.join(
    artifactDirectory,
    `screenshot-${screenshotNumber}.${extension}`,
  );
  await writeFile(screenshotPath, Buffer.from(image.data, "base64"));
  return { path: screenshotPath, mimeType: image.mimeType };
}
