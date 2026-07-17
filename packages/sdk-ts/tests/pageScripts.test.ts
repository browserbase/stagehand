import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
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
});
