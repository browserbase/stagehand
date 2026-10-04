import { describe, expect, it } from "vitest";
import { transportSafeText } from "../src/facade/output.js";

describe("facade transport text", () => {
  it("escapes Unicode line separators without changing structured JSON values", () => {
    const value = { text: "people.\u2028Next\u2029paragraph\u0085line 🏈" };
    const text = transportSafeText(JSON.stringify(value));
    expect(text).not.toMatch(/[\u0085\u2028\u2029]/u);
    expect(JSON.parse(text)).toEqual(value);
    expect(transportSafeText("ordinary text")).toBe("ordinary text");
  });
});
