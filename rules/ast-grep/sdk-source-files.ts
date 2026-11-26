import { readdir } from "node:fs/promises";

const typescriptSource = new URL("../../packages/sdk-ts/src/", import.meta.url);
const browserApiSource = new URL("../../packages/shared/browser-api/src/", import.meta.url);

export async function sdkSourceFiles(source: URL): Promise<string[]> {
  const files = await readdir(source, { recursive: true });
  if (source.href === typescriptSource.href) {
    const sharedFiles = await readdir(browserApiSource, { recursive: true });
    files.push(...sharedFiles.map((file) => `../../shared/browser-api/src/${file}`));
  }
  return files.sort();
}
