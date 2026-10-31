import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { normalizeEvaluationExpression, normalizeInitScriptSource } from "../src/pageScripts.js";

describe("page script normalization", () => {
  it("normalizes evaluation expressions and JSON function arguments", () => {
    expect(normalizeEvaluationExpression("document.title")).toBe("document.title");

    const expression = (arg: { camelCase: string }) => arg.camelCase;
    expect(runInNewContext(normalizeEvaluationExpression(expression, { camelCase: "kept" }))).toBe(
      "kept",
    );
    expect(normalizeEvaluationExpression(expression)).toBe(`(${expression.toString()})(undefined)`);
  });

  it("preserves own JSON keys in evaluation arguments", () => {
    const arg = JSON.parse(
      '{"__proto__":{"kept":true},"nested":[{"__proto__":null,"constructor":"value"}]}',
    );
    const source = normalizeEvaluationExpression((value: unknown) => JSON.stringify(value), arg);
    expect(runInNewContext(source)).toBe(JSON.stringify(arg));
  });

  it("does not turn evaluation data into an inherited property", () => {
    const arg = JSON.parse('{"__proto__":{"inherited":"unexpected"}}');
    const source = normalizeEvaluationExpression(
      (value: Record<string, unknown>) =>
        Object.hasOwn(value, "__proto__") && !("inherited" in value),
      arg,
    );
    expect(runInNewContext(source)).toBe(true);
  });

  it("preserves own JSON keys in init script arguments", async () => {
    const arg = JSON.parse('{"nested":{"__proto__":{"kept":true}},"__proto__":42}');
    for (const caller of ["page.addInitScript", "context.addInitScript"]) {
      const source = await normalizeInitScriptSource(
        (value: unknown) => JSON.stringify(value),
        arg,
        caller,
      );
      expect(runInNewContext(source)).toBe(JSON.stringify(arg));
    }
  });

  it.each([
    undefined,
    null,
    false,
    42,
    'quotes " and backslash \\ and newline \n and Unicode \u2028\u2029 雪',
    [null, { text: "</script>" }],
  ])("round-trips JSON argument %j", async (arg) => {
    const callback = (value: unknown) => JSON.stringify(value);
    expect(runInNewContext(normalizeEvaluationExpression(callback, arg))).toBe(JSON.stringify(arg));
    expect(runInNewContext(await normalizeInitScriptSource(callback, arg))).toBe(
      JSON.stringify(arg),
    );
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
    expect(runInNewContext(await normalizeInitScriptSource(script, { ready: true }))).toBe(true);
  });

  it("reads init script paths and appends a source URL", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "stagehand-page-script-"));
    const filePath = path.join(directory, "init.js");

    try {
      await writeFile(filePath, "globalThis.fromPath = true", "utf8");
      await expect(normalizeInitScriptSource({ path: filePath })).resolves.toBe(
        `globalThis.fromPath = true\n//# sourceURL=${filePath}`,
      );
    } finally {
      await rm(directory, { recursive: true });
    }
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
});
