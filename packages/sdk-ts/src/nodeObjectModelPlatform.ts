import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Buffer } from "node:buffer";
import { MAX_INPUT_FILE_BYTES } from "@browserbasehq/stagehand-shared-object-model/fileUpload";
import type { ObjectModelPlatform } from "@browserbasehq/stagehand-shared-object-model/objectModelPlatform";

/** Node capabilities supplied by the SDK; never imported by the shared object model. */
export const nodeObjectModelPlatform: ObjectModelPlatform = {
  readInputFile,
  readTextFile: (path) => fs.readFile(path, "utf8"),
  writeCaptureFile: (path, bytes) => fs.writeFile(path, bytes),
  emitWarning: (message, code) => process.emitWarning(message, { code }),
  encodeBase64: (bytes) => Buffer.from(bytes).toString("base64"),
  utf8ByteLengthExceeds: (value, limit) => Buffer.byteLength(value, "utf8") > limit,
};

async function readInputFile(file: string) {
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
