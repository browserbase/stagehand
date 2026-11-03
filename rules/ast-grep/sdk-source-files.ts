import { readdir } from "node:fs/promises";

const typescriptSource = new URL("../../packages/sdk-ts/src/", import.meta.url);
const sharedObjectModelSource = new URL("../../packages/shared-object-model/src/", import.meta.url);

/** Include the object model when checking the complete TypeScript SDK implementation. */
export async function sdkSourceFiles(source: URL): Promise<string[]> {
  const files = await readdir(source, { recursive: true });
  if (source.href === typescriptSource.href) {
    const sharedFiles = await readdir(sharedObjectModelSource, { recursive: true });
    files.push(...sharedFiles.map((file) => `../../shared-object-model/src/${file}`));
  }
  return files.sort();
}
