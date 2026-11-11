import { browserObjectModelPlatform, type ObjectModelPlatform } from "./objectModelPlatform.js";
import type { InputFilePayload } from "@browserbasehq/stagehand-protocol/types";

export const MAX_INPUT_FILE_BYTES = 50 * 1024 * 1024;

export type FilePayload = {
  name: string;
  mimeType?: string;
  buffer: ArrayBuffer | Uint8Array | string;
  lastModified?: number;
};

export type FileInput = string | string[] | FilePayload | FilePayload[];

export async function normalizeFileInput(
  files: FileInput,
  platform: ObjectModelPlatform = browserObjectModelPlatform,
): Promise<InputFilePayload[]> {
  const entries = Array.isArray(files) ? files : [files];
  const payloads: InputFilePayload[] = [];
  for (const entry of entries) payloads.push(await normalizeFile(entry, platform));
  return payloads;
}

async function normalizeFile(
  file: string | FilePayload,
  platform: ObjectModelPlatform,
): Promise<InputFilePayload> {
  if (typeof file === "string") {
    return platform.readInputFile(file);
  }

  if (!file.name) throw new TypeError("setInputFiles(): file payload name cannot be empty");
  if (typeof file.buffer === "string") {
    const exceedsLimit = platform.utf8ByteLengthExceeds(file.buffer, MAX_INPUT_FILE_BYTES);
    if (exceedsLimit) {
      throw new RangeError(`setInputFiles(): file is larger than the 50 MiB upload limit`);
    }
  }
  const bytes =
    typeof file.buffer === "string"
      ? new TextEncoder().encode(file.buffer)
      : ArrayBuffer.isView(file.buffer)
        ? file.buffer
        : new Uint8Array(file.buffer);
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
    data: platform.encodeBase64(bytes),
    ...(file.lastModified === undefined ? {} : { lastModified: file.lastModified }),
  };
}
