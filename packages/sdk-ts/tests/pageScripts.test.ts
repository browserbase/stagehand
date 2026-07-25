import { describe, expect, it } from "vitest";
import { normalizeEvaluationExpression, normalizeInitScriptSource } from "../src/pageScripts.js";

describe("page script normalization", () => {
  it("normalizes evaluation expressions and JSON function arguments", () => {
    expect(normalizeEvaluationExpression("document.title")).toBe("document.title");

    const expression = (arg: { camelCase: string }) => arg.camelCase;
    expect(normalizeEvaluationExpression(expression, { camelCase: "kept" })).toBe(
      `(${expression.toString()})({"camelCase":"kept"})`,
    );
    expect(normalizeEvaluationExpression(expression)).toBe(`(${expression.toString()})(undefined)`);
  });

  it("rejects non-JSON evaluation arguments", () => {
    expect(() => normalizeEvaluationExpression((arg: unknown) => arg, { value: 1n })).toThrow(
      "'arg' must be JSON-serializable",
    );
  });

  it("normalizes init script strings, content, and functions", async () => {
    await expect(normalizeInitScriptSource("globalThis.ready = true")).resolves.toBe(
      "globalThis.ready = true",
    );
    await expect(
      normalizeInitScriptSource({ content: "globalThis.fromContent = true" }),
    ).resolves.toBe("globalThis.fromContent = true");

    const script = (arg: { ready: boolean }) => arg.ready;
    await expect(normalizeInitScriptSource(script, { ready: true })).resolves.toBe(
      `(${script.toString()})({"ready":true})`,
    );
  });

  it("rejects invalid init script sources and non-JSON arguments", async () => {
    await expect(normalizeInitScriptSource({} as never)).rejects.toThrow("object with content");
    await expect(normalizeInitScriptSource({ path: "init.js" } as never)).rejects.toThrow(
      "object with content",
    );
    await expect(
      normalizeInitScriptSource("globalThis.ready = true", { ignored: true }),
    ).rejects.toThrow("'arg' is only supported when passing a function");
    await expect(normalizeInitScriptSource((arg: unknown) => arg, { value: 1n })).rejects.toThrow(
      "'arg' must be JSON-serializable",
    );
  });

  it("uses the provided init script caller in validation errors", async () => {
    await expect(
      normalizeInitScriptSource((arg: unknown) => arg, { value: 1n }, "context.addInitScript"),
    ).rejects.toThrow("context.addInitScript: 'arg' must be JSON-serializable");
  });
});
