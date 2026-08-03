import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { InputFilePayload } from "../../protocol/types.js";

export type FilePayload = {
  name: string;
  mimeType?: string;
  buffer: ArrayBuffer | Uint8Array | string;
  lastModified?: number;
};

export type FileInput = string | string[] | FilePayload | FilePayload[];

export async function normalizeFileInput(files: FileInput): Promise<InputFilePayload[]> {
  const entries = Array.isArray(files) ? files : [files];
  return await Promise.all(entries.map(normalizeFile));
}

async function normalizeFile(file: string | FilePayload): Promise<InputFilePayload> {
  if (typeof file === "string") {
    const absolutePath = resolve(file);
    const fileStat = await stat(absolutePath).catch((error: unknown) => {
      throw new Error(`setInputFiles(): could not read file at ${absolutePath}`, { cause: error });
    });
    if (!fileStat.isFile()) {
      throw new TypeError(`setInputFiles(): expected a file at ${absolutePath}`);
    }
    return {
      name: basename(absolutePath),
      data: (await readFile(absolutePath)).toString("base64"),
      lastModified: Math.trunc(fileStat.mtimeMs),
    };
  }

  if (!file.name) throw new TypeError("setInputFiles(): file payload name cannot be empty");
  const bytes =
    typeof file.buffer === "string"
      ? Buffer.from(file.buffer)
      : file.buffer instanceof Uint8Array
        ? Buffer.from(file.buffer)
        : Buffer.from(file.buffer);
  return {
    name: file.name,
    ...(file.mimeType ? { mimeType: file.mimeType } : {}),
    data: bytes.toString("base64"),
    ...(file.lastModified === undefined ? {} : { lastModified: file.lastModified }),
  };
}
