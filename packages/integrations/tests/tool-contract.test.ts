import { describe, expect, it } from "vitest";
import {
  codeExecuteOutputSchema,
  codeExecuteResultText,
  codeExecuteSchema,
} from "../src/codemode/tool-contract.js";

describe("code-mode tool contract", () => {
  it("accepts nonblank code up to 100,000 UTF-8 bytes", () => {
    expect(codeExecuteSchema.parse({ code: "return 1;" })).toStrictEqual({ code: "return 1;" });
    expect(codeExecuteSchema.safeParse({ code: " \n\t " }).success).toBe(false);
    expect(codeExecuteSchema.safeParse({ code: "é".repeat(50_000) }).success).toBe(true);
    expect(codeExecuteSchema.safeParse({ code: `${"é".repeat(50_000)}a` }).success).toBe(false);
  });

  it("validates complete success and failure results", () => {
    expect(
      codeExecuteOutputSchema.parse({
        ok: true,
        page: { url: "https://example.com", title: "Example" },
        value: { answer: 42 },
        logs: [{ level: "log", text: "ready" }],
      }),
    ).toMatchObject({ ok: true, value: { answer: 42 } });

    expect(
      codeExecuteOutputSchema.parse({
        ok: false,
        error: { kind: "runtime", name: "Error", message: "failed" },
      }),
    ).toMatchObject({ ok: false, error: { kind: "runtime" } });
  });

  it("rejects invalid success/failure combinations", () => {
    expect(codeExecuteOutputSchema.safeParse({ ok: true }).success).toBe(false);
    expect(
      codeExecuteOutputSchema.safeParse({
        ok: true,
        page: { url: "https://example.com", title: "Example" },
        error: { kind: "runtime", name: "Error", message: "failed" },
      }).success,
    ).toBe(false);
    expect(codeExecuteOutputSchema.safeParse({ ok: false }).success).toBe(false);
    expect(
      codeExecuteOutputSchema.safeParse({
        ok: false,
        value: 42,
        error: { kind: "runtime", name: "Error", message: "failed" },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown error kinds and log levels", () => {
    expect(
      codeExecuteOutputSchema.safeParse({
        ok: false,
        error: { kind: "timeout", name: "Error", message: "failed" },
      }).success,
    ).toBe(false);
    expect(
      codeExecuteOutputSchema.safeParse({
        ok: true,
        page: { url: "https://example.com", title: "Example" },
        logs: [{ level: "debug", text: "nope" }],
      }).success,
    ).toBe(false);
  });

  it("renders the result as stable pretty JSON", () => {
    expect(
      codeExecuteResultText({
        ok: true,
        page: { url: "https://example.com", title: "Example" },
        value: 42,
      }),
    ).toBe(
      '{\n  "ok": true,\n  "page": {\n    "url": "https://example.com",\n    "title": "Example"\n  },\n  "value": 42\n}',
    );
  });
});
