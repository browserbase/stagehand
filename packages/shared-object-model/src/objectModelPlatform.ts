import type { InputFilePayload } from "@browserbasehq/stagehand-protocol/types";

/** Host capabilities used by the object model, supplied by its command client. */
export interface ObjectModelPlatform {
  readInputFile(path: string): Promise<InputFilePayload>;
  readTextFile(path: string, caller: string): Promise<string>;
  writeCaptureFile(path: string, bytes: Uint8Array, method: "screenshot" | "pdf"): Promise<void>;
  emitWarning(message: string, code: string): void;
  encodeBase64(bytes: Uint8Array): string;
  utf8ByteLengthExceeds(value: string, limit: number): boolean;
}

/** Portable default for command clients without host filesystem access. */
export const browserObjectModelPlatform: ObjectModelPlatform = {
  async readInputFile() {
    throw new TypeError(
      "setInputFiles(): file paths are only supported in Node.js; use a file payload instead",
    );
  },
  async readTextFile(_path, caller) {
    throw new TypeError(
      `${caller}: path is only supported in Node.js; use content or a function instead`,
    );
  },
  async writeCaptureFile(_path, _bytes, method) {
    throw new TypeError(
      `page.${method}(): path is only supported in Node.js; omit path to receive ${method === "pdf" ? "PDF" : "screenshot"} bytes`,
    );
  },
  emitWarning(message, code) {
    // oxlint-disable-next-line no-console -- Browser hosts report object-model warnings through the console.
    console.warn(`[${code}] ${message}`);
  },
  encodeBase64,
  utf8ByteLengthExceeds,
};

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
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
