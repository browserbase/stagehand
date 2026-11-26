import { describe, expect, it } from "vitest";
import { safeJson, stringifyError } from "../src/index.js";

const secretKey = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789";
const secretUrl = "https://example.test/v1?apiKey=super-secret-value&mode=x";

describe("Codex safeJson / stringifyError", () => {
  it("redacts secrets inside a non-Error error object", () => {
    const error = { code: "unauthorized", detail: `bad key ${secretKey}`, url: secretUrl };
    for (const text of [safeJson(error), stringifyError(error)]) {
      expect(text).toBeDefined();
      expect(text).not.toContain(secretKey);
      expect(text).not.toContain("super-secret-value");
      expect(text).toContain("sk-proj-a");
      expect(text).toContain("[redacted]");
    }
  });

  it("omits large binary data fields", () => {
    const data = "A".repeat(10_000);
    const error = { type: "image", data };
    for (const text of [safeJson(error), stringifyError(error)]) {
      expect(text).not.toContain(data);
      expect(text).toContain("binary omitted");
    }
  });
});
