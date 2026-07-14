import { describe, expect, it } from "vite-plus/test";
import { StagehandInvalidArgumentError } from "../errors.js";
import type { SetInputFilesArgument } from "../types/private/fileUpload.js";
import { bytesToBase64, normalizeInputFiles, toBytes } from "./fileUploadUtils.js";

describe("file upload payload normalization", () => {
  it("normalizes supported in-memory payloads without sharing mutable byte storage", async () => {
    const sourceBytes = new Uint8Array([0, 127, 255]);
    const sourceBuffer = new Uint8Array([4, 5, 6]).buffer;

    const normalized = await normalizeInputFiles([
      {
        name: "message.txt",
        mimeType: "text/plain",
        buffer: "hello",
        lastModified: 42,
      },
      { name: "bytes.bin", buffer: sourceBytes },
      { name: "array-buffer.bin", buffer: sourceBuffer },
    ]);

    expect(normalized).toHaveLength(3);
    expect(normalized[0]).toEqual({
      name: "message.txt",
      mimeType: "text/plain",
      bytes: new Uint8Array([104, 101, 108, 108, 111]),
      lastModified: 42,
    });
    expect(normalized[1]?.mimeType).toBe("application/octet-stream");
    expect(normalized[1]?.bytes).toEqual(new Uint8Array([0, 127, 255]));
    expect(normalized[2]?.bytes).toEqual(new Uint8Array([4, 5, 6]));

    sourceBytes[0] = 9;
    new Uint8Array(sourceBuffer)[0] = 9;
    expect(normalized[1]?.bytes[0]).toBe(0);
    expect(normalized[2]?.bytes[0]).toBe(4);
  });

  it("rejects filesystem paths and malformed payloads through the public Zod schema", async () => {
    await expect(
      normalizeInputFiles("./local-file.txt" as unknown as SetInputFilesArgument),
    ).rejects.toBeInstanceOf(StagehandInvalidArgumentError);
    await expect(
      normalizeInputFiles({ name: "", buffer: "data" } as SetInputFilesArgument),
    ).rejects.toThrow("expected an in-memory file payload");
  });

  it("converts every supported binary input to independent bytes", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const converted = toBytes(bytes);

    expect(converted).toEqual(bytes);
    expect(converted).not.toBe(bytes);
    expect(toBytes(bytes.buffer)).toEqual(bytes);
    expect(toBytes("✓")).toEqual(new TextEncoder().encode("✓"));
  });

  it("base64-encodes payloads larger than a JavaScript argument-list chunk", () => {
    const bytes = new Uint8Array(70_000);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;

    const decoded = globalThis.atob(bytesToBase64(bytes));

    expect(decoded).toHaveLength(bytes.length);
    expect(decoded.charCodeAt(0)).toBe(bytes[0]);
    expect(decoded.charCodeAt(32_768)).toBe(bytes[32_768]);
    expect(decoded.charCodeAt(bytes.length - 1)).toBe(bytes.at(-1));
  });
});
