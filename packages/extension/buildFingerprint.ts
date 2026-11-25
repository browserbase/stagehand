import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const EXTENSION_BUILD_INFO_FILE = "extension-build.json";

export type ExtensionBuildInfo = {
  extensionVersion: string;
  protocolVersion: string;
  fingerprint: string;
};

export function fingerprintFiles(files: ReadonlyMap<string, Uint8Array>): string {
  const lines = [...files.keys()]
    .toSorted((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map((relativePath) => `${sha256(files.get(relativePath)!)}  ${relativePath}\n`);
  return sha256(Buffer.from(lines.join("")));
}

export async function readDirectoryFiles(directory: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    const absolutePath = path.join(entry.parentPath, entry.name);
    const relativePath = path.relative(directory, absolutePath).split(path.sep).join("/");
    if (!entry.isFile()) throw new Error(`Unsupported extension build entry: ${relativePath}`);
    files.set(relativePath, await readFile(absolutePath));
  }
  return files;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
