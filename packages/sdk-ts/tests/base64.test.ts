import { describe, expect, it } from "vitest";
import { decodeBase64 } from "../src/base64.js";

describe("decodeBase64", () => {
  it.each([
    ["", []],
    ["YQ==", [97]],
    ["YWI=", [97, 98]],
    ["YWJj", [97, 98, 99]],
    ["+/8=", [251, 255]],
  ])("decodes canonical base64 %j", (value, expected) => {
    expect(Array.from(decodeBase64(value, "test"))).toEqual(expected);
  });

  it("decodes a base64 payload larger than 8 MiB", () => {
    const value = "BwcH".repeat(3 * 1024 * 1024);

    const bytes = decodeBase64(value, "test");

    expect(bytes.length).toBe(9 * 1024 * 1024);
    expect(bytes.every((byte) => byte === 7)).toBe(true);
  });

  it.each([
    "abc!",
    "ab=c",
    "a=bc",
    "A",
    "YQ",
    "YWI",
    "YQ=",
    "YQ===",
    "Zh==",
    "YWJ=",
    "Y Q==",
    "YQ==\n",
    "YQ==\r\n",
    "-_8=",
  ])("rejects malformed or noncanonical base64 %j", (value) => {
    expect(() => decodeBase64(value, "test")).toThrow("test returned invalid base64");
  });
});
