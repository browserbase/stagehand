import { open } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { InputFilePayload } from "../../protocol/types.js";

const MAX_INPUT_FILE_BYTES = 50 * 1024 * 1024;

export type FilePayload = {
  name: string;
  mimeType?: string;
  buffer: ArrayBuffer | Uint8Array | string;
  lastModified?: number;
};

export type FileInput = string | string[] | FilePayload | FilePayload[];

export async function normalizeFileInput(files: FileInput): Promise<InputFilePayload[]> {
  const entries = Array.isArray(files) ? files : [files];
  const payloads: InputFilePayload[] = [];
  for (const entry of entries) payloads.push(await normalizeFile(entry));
  return payloads;
}

async function normalizeFile(file: string | FilePayload): Promise<InputFilePayload> {
  if (typeof file === "string") {
    const absolutePath = resolve(file);
    const handle = await open(absolutePath, "r").catch(() => {
      throw new TypeError("setInputFiles(): could not read file");
    });
    try {
      const fileStat = await handle.stat().catch(() => {
        throw new TypeError("setInputFiles(): could not read file");
      });
      if (!fileStat.isFile()) {
        throw new TypeError("setInputFiles(): expected a file");
      }
      if (fileStat.size > MAX_INPUT_FILE_BYTES) {
        throw new RangeError(`setInputFiles(): file is larger than the 50 MiB upload limit`);
      }

      const chunks: Buffer[] = [];
      let bytesRead = 0;
      try {
        for await (const chunk of handle.createReadStream({
          autoClose: false,
          end: MAX_INPUT_FILE_BYTES,
          start: 0,
        })) {
          const bytes = Buffer.from(chunk);
          chunks.push(bytes);
          bytesRead += bytes.byteLength;
        }
      } catch {
        throw new TypeError("setInputFiles(): could not read file");
      }
      if (bytesRead > MAX_INPUT_FILE_BYTES) {
        throw new RangeError(`setInputFiles(): file is larger than the 50 MiB upload limit`);
      }

      const lastModified = Math.trunc(fileStat.mtimeMs);
      return {
        name: basename(absolutePath),
        data: Buffer.concat(chunks, bytesRead).toString("base64"),
        ...(lastModified < 0 ? {} : { lastModified }),
      };
    } finally {
      await handle.close().catch(() => {});
    }
  }

  if (!file.name) throw new TypeError("setInputFiles(): file payload name cannot be empty");
  const normalizedBuffer =
    file.buffer instanceof ArrayBuffer ? new Uint8Array(file.buffer) : file.buffer;
  const bytes = Buffer.from(normalizedBuffer);
  if (bytes.byteLength > MAX_INPUT_FILE_BYTES) {
    throw new RangeError(`setInputFiles(): file is larger than the 50 MiB upload limit`);
  }
  if (
    file.lastModified !== undefined &&
    (!Number.isInteger(file.lastModified) || file.lastModified < 0)
  ) {
    throw new RangeError("setInputFiles(): lastModified must be a non-negative integer");
  }
  return {
    name: file.name,
    ...(file.mimeType ? { mimeType: file.mimeType } : {}),
    data: bytes.toString("base64"),
    ...(file.lastModified === undefined ? {} : { lastModified: file.lastModified }),
  };
}
