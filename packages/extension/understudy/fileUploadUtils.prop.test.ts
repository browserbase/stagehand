import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import type { SetInputFilesArgument } from "../types/private/fileUpload.js";
import { bytesToBase64, normalizeInputFiles, toBytes } from "./fileUploadUtils.js";

const BASE_SEED = 20261124;

describe("fileUploadUtils adversarial properties", () => {
  it("round-trips bytesToBase64 losslessly across arbitrary byte payloads and subarray views", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 512 }),
        fc.integer({ min: 0, max: 64 }),
        fc.integer({ min: 0, max: 64 }),
        (raw, startRaw, lenRaw) => {
          const start = Math.min(startRaw, raw.length);
          const end = Math.min(start + lenRaw, raw.length);
          const view = raw.subarray(start, end);

          const encoded = bytesToBase64(view);
          expect(encoded).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
          expect(encoded.length).toBe(4 * Math.ceil(view.length / 3));

          const decoded = Uint8Array.from(Buffer.from(encoded, "base64"));
          expect(decoded).toStrictEqual(new Uint8Array(view));
        },
      ),
      { seed: BASE_SEED, numRuns: 200 },
    );
  });

  it("round-trips bytesToBase64 accurately across chunk size boundaries", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(32_767, 32_768, 32_769, 65_535, 65_536, 65_537),
        fc.integer({ min: 0, max: 255 }),
        (length, salt) => {
          const bytes = new Uint8Array(length);
          for (let i = 0; i < length; i += 1) {
            bytes[i] = (i * 31 + salt) & 0xff;
          }
          const encoded = bytesToBase64(bytes);
          expect(encoded.length).toBe(4 * Math.ceil(length / 3));
          const decoded = Buffer.from(encoded, "base64");
          expect(decoded.length).toBe(length);
          expect(decoded.equals(bytes)).toBe(true);
        },
      ),
      { seed: BASE_SEED + 1, numRuns: 20 },
    );
  });

  it("defensively copies Uint8Array views, ArrayBuffers, and UTF-8 strings in toBytes", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 128 }),
        fc.integer({ min: 0, max: 32 }),
        fc.string({ maxLength: 64 }),
        (source, offsetRaw, text) => {
          const offset = Math.min(offsetRaw, source.length - 1);
          const slice = source.subarray(offset);
          const snapshot = new Uint8Array(slice);

          const fromView = toBytes(slice);
          const fromBuffer = toBytes(snapshot.buffer.slice(0));
          const bufCopy = snapshot.buffer.slice(0);
          const fromMutableBuf = toBytes(bufCopy);

          source[offset] = (source[offset]! + 1) & 0xff;
          new Uint8Array(bufCopy)[0] = (new Uint8Array(bufCopy)[0]! + 1) & 0xff;

          expect(fromView).toStrictEqual(snapshot);
          expect(fromBuffer).toStrictEqual(snapshot);
          expect(fromMutableBuf).toStrictEqual(snapshot);
          expect(toBytes(text)).toStrictEqual(new TextEncoder().encode(text));
        },
      ),
      { seed: BASE_SEED + 2, numRuns: 150 },
    );
  });

  it("preserves order, defaults mimeType, retains lastModified=0, and isolates mutable buffers in normalizeInputFiles", async () => {
    const bufferArb = fc.oneof(
      fc.string({ maxLength: 40 }),
      fc.uint8Array({ maxLength: 40 }),
      fc
        .uint8Array({ maxLength: 40 })
        .map((u) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)),
    );
    const payloadArb = fc.record({
      name: fc.string({ minLength: 1, maxLength: 24 }),
      mimeType: fc.option(fc.string({ minLength: 1, maxLength: 24 }), { nil: undefined }),
      buffer: bufferArb,
      lastModified: fc.option(
        fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 2_000_000_000 })),
        {
          nil: undefined,
        },
      ),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(payloadArb, { maxLength: 6 }), async (entries) => {
        const inputs = entries.map((e) => ({
          name: e.name,
          buffer: e.buffer,
          ...(e.mimeType !== undefined ? { mimeType: e.mimeType } : {}),
          ...(e.lastModified !== undefined ? { lastModified: e.lastModified } : {}),
        }));

        const normalized = await normalizeInputFiles(inputs);
        expect(normalized).toHaveLength(inputs.length);

        for (let i = 0; i < inputs.length; i += 1) {
          const input = inputs[i]!;
          const out = normalized[i]!;
          expect(out.name).toBe(input.name);
          expect(out.mimeType).toBe(input.mimeType ?? "application/octet-stream");
          expect(out.bytes).toStrictEqual(toBytes(input.buffer));
          if (input.lastModified !== undefined) {
            expect(out.lastModified).toBe(input.lastModified);
          } else {
            expect(Number.isInteger(out.lastModified)).toBe(true);
            expect(out.lastModified).toBeGreaterThanOrEqual(0);
          }
        }

        if (inputs.length === 1) {
          const single = await normalizeInputFiles(inputs[0]!);
          expect(single).toHaveLength(1);
          expect(single[0]!.name).toBe(normalized[0]!.name);
          expect(single[0]!.bytes).toStrictEqual(normalized[0]!.bytes);
        }
      }),
      { seed: BASE_SEED + 3, numRuns: 100 },
    );
  });

  it("strictly rejects malformed payloads via Zod", async () => {
    const invalidArb = fc.oneof(
      fc.constant({ name: "", buffer: "x" }),
      fc.constant({ name: "a.txt", mimeType: "", buffer: "x" }),
      fc.integer({ min: -1000, max: -1 }).map((lastModified) => ({
        name: "a.txt",
        buffer: "x",
        lastModified,
      })),
      fc.constant({ name: "a.txt", buffer: "x", lastModified: 1.5 }),
      fc.constant({ name: "a.txt", buffer: "x", extraField: true }),
      fc.constant("/etc/passwd"),
      fc.constant(null),
      fc.constant(123),
    );

    await fc.assert(
      fc.asyncProperty(invalidArb, async (bad) => {
        await expect(
          normalizeInputFiles(bad as unknown as SetInputFilesArgument),
        ).rejects.toBeInstanceOf(z.ZodError);
      }),
      { seed: BASE_SEED + 4, numRuns: 40 },
    );
  });
});
