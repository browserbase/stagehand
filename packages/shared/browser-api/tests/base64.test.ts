import { describe, expect, it } from "vitest";
import { decodeBase64 } from "../src/base64.js";

describe("decodeBase64", () => {
  it("decodes valid base64 payloads across padding forms", () => {
    expect(decodeBase64("", "test")).toStrictEqual(new Uint8Array(0));
    expect(decodeBase64("YQ==", "test")).toStrictEqual(new TextEncoder().encode("a"));
    expect(decodeBase64("YWI=", "test")).toStrictEqual(new TextEncoder().encode("ab"));
    expect(decodeBase64("YWJj", "test")).toStrictEqual(new TextEncoder().encode("abc"));
  });

  it("decodes large base64 payloads without overflowing the call stack", () => {
    const raw = new Uint8Array(6 * 1024 * 1024);
    raw.fill(7);
    const encoded = Buffer.from(raw).toString("base64");

    const decoded = decodeBase64(encoded, "page.screenshot");
    expect(decoded.byteLength).toBe(raw.byteLength);
    expect(decoded[0]).toBe(7);
    expect(decoded[decoded.length - 1]).toBe(7);
  });

  it("rejects malformed and non-canonical base64 inputs", () => {
    for (const invalid of ["abc", "%%%%", "ab=c", "a===", "====", "Zh=="]) {
      expect(() => decodeBase64(invalid, "response.body")).toThrow(
        "response.body returned invalid base64",
      );
    }
  });
});
