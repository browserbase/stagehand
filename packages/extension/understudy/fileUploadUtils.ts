import { StagehandInvalidArgumentError } from "../errors.js";
import {
  SetInputFilePayloadSchema,
  type SetInputFilesArgument,
} from "../types/private/fileUpload.js";
import type { NormalizedFilePayload } from "../types/private/locator.js";

const DEFAULT_MIME_TYPE = "application/octet-stream";

/** Normalize in-memory file payloads for worker-safe page injection. */
export async function normalizeInputFiles(
  files: SetInputFilesArgument,
): Promise<NormalizedFilePayload[]> {
  const flattened = Array.isArray(files) ? files : [files];
  if (!flattened.length) return [];

  return flattened.map((entry) => {
    const result = SetInputFilePayloadSchema.safeParse(entry);
    if (!result.success) {
      throw new StagehandInvalidArgumentError(
        `setInputFiles(): expected an in-memory file payload: ${result.error.message}`,
      );
    }

    const payload = result.data;
    return {
      name: payload.name,
      mimeType: payload.mimeType ?? DEFAULT_MIME_TYPE,
      bytes: toBytes(payload.buffer),
      lastModified: payload.lastModified ?? Date.now(),
    };
  });
}

export function toBytes(data: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (data instanceof Uint8Array) return new Uint8Array(data);
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  throw new StagehandInvalidArgumentError("Unsupported file payload buffer type");
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    chunks.push(String.fromCharCode(...chunk));
  }
  return globalThis.btoa(chunks.join(""));
}
