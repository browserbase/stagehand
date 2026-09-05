import type { InputFilePayload } from "@browserbasehq/stagehand-protocol/types";

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
    const fsModuleName = "node:" + "fs/promises";
    const pathModuleName = "node:" + "path";
    const [fs, path] = await Promise.all([
      import(/* @vite-ignore */ fsModuleName) as Promise<typeof import("node:fs/promises")>,
      import(/* @vite-ignore */ pathModuleName) as Promise<typeof import("node:path")>,
    ]).catch(() => {
      throw new TypeError(
        "setInputFiles(): file paths are only supported in Node.js; use a file payload instead",
      );
    });
    const absolutePath = path.resolve(file);
    const handle = await fs.open(absolutePath, "r").catch(() => {
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
        name: path.basename(absolutePath),
        data: Buffer.concat(chunks, bytesRead).toString("base64"),
        ...(lastModified < 0 ? {} : { lastModified }),
      };
    } finally {
      await handle.close().catch(() => {});
    }
  }

  if (!file.name) throw new TypeError("setInputFiles(): file payload name cannot be empty");
  if (typeof file.buffer === "string") {
    const nodeBuffer = (globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer;
    const exceedsLimit = nodeBuffer
      ? nodeBuffer.byteLength(file.buffer, "utf8") > MAX_INPUT_FILE_BYTES
      : utf8ByteLengthExceeds(file.buffer, MAX_INPUT_FILE_BYTES);
    if (exceedsLimit) {
      throw new RangeError(`setInputFiles(): file is larger than the 50 MiB upload limit`);
    }
  }
  const bytes =
    typeof file.buffer === "string"
      ? new TextEncoder().encode(file.buffer)
      : file.buffer instanceof ArrayBuffer
        ? new Uint8Array(file.buffer)
        : file.buffer;
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
    data: encodeBase64(bytes),
    ...(file.lastModified === undefined ? {} : { lastModified: file.lastModified }),
  };
}

function utf8ByteLengthExceeds(value: string, limit: number): boolean {
  let byteLength = 0;
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      byteLength += 1;
    } else if (codeUnit <= 0x7ff) {
      byteLength += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      byteLength += 4;
      index += 1;
    } else {
      // BMP characters and lone surrogates both encode to three bytes.
      byteLength += 3;
    }
    if (byteLength > limit) return true;
  }
  return false;
}

function encodeBase64(bytes: Uint8Array): string {
  const nodeBuffer = (globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer;
  if (nodeBuffer) return nodeBuffer.from(bytes).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
