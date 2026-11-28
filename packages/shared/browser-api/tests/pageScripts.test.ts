import { runInNewContext } from "node:vm";
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

  it("rejects ambiguous init script sources and non-JSON arguments", async () => {
    await expect(normalizeInitScriptSource({})).rejects.toThrow("exactly one of path or content");
    await expect(
      normalizeInitScriptSource({ path: "init.js", content: "globalThis.ready = true" }),
    ).rejects.toThrow("exactly one of path or content");
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

  it("preserves async arrows with regex and division default parameters", async () => {
    const regexDefault = runInNewContext("async (arg = /\\)/) => arg") as (
      arg?: unknown,
    ) => Promise<unknown>;
    const normalizedRegex = normalizeEvaluationExpression(regexDefault);
    expect(normalizedRegex).toBe(`(${regexDefault.toString()})(undefined)`);
    const regexResult = (await runInNewContext(normalizedRegex)) as RegExp;
    expect(regexResult.source).toBe("\\)");

    const divisionDefault = runInNewContext("async (a = 1 / 2 / 3) => a") as (
      a?: unknown,
    ) => Promise<unknown>;
    const normalizedDivision = normalizeEvaluationExpression(divisionDefault);
    expect(normalizedDivision).toBe(`(${divisionDefault.toString()})(undefined)`);
    await expect(runInNewContext(normalizedDivision)).resolves.toBe(1 / 2 / 3);

    const divisionThenRegex = runInNewContext("async (a = 1 / /\\)/.source.length) => a") as (
      a?: unknown,
    ) => Promise<unknown>;
    const normalizedMixed = normalizeEvaluationExpression(divisionThenRegex);
    expect(normalizedMixed).toBe(`(${divisionThenRegex.toString()})(undefined)`);
    await expect(runInNewContext(normalizedMixed)).resolves.toBe(0.5);

    const conciseAsyncMethod = runInNewContext("({ async(a = /\\)/) { return a; } }).async") as (
      a?: unknown,
    ) => unknown;
    const normalizedConcise = normalizeEvaluationExpression(conciseAsyncMethod);
    const conciseResult = runInNewContext(normalizedConcise) as RegExp;
    expect(conciseResult.source).toBe("\\)");
  });
});
