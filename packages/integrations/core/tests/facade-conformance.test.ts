import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Stagehand } from "@browserbasehq/stagehand";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { facadeBundle } from "../src/facade/bundle.js";
import { StagehandFacadeInputError, StagehandFacadeTools } from "../src/facade/tools.js";

// Runs the language-neutral cases in ../conformance against the TypeScript host.
// See ../conformance/README.md for the case format.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type ConformanceCall =
  | { tool: "run"; code: string }
  | { tool: "run"; actions: Json[] }
  | { tool: "snapshot"; includeIframes?: boolean }
  | { tool: "screenshot"; fullPage?: boolean; type?: "png" | "jpeg"; quality?: number };

type ExpectedError = {
  kind: "input" | "invalid" | "execution" | "batch" | "syntax";
  name?: string;
  message?: string;
  contractError?: string;
  params?: Record<string, string>;
};

type ConformanceStep = {
  pageUrl?: string;
  snapshot?: { formattedTree: string; xpathMap: Record<string, string> };
  screenshotOptions?: Json;
  call: ConformanceCall;
  batch: ({ return: Json } | { throw: { name: string; message: string } })[];
  sent?: Json[];
  expect: { result: Json } | { error: ExpectedError };
};

type ConformanceCase = {
  name: string;
  notApplicable?: Record<string, string>;
  page?: {
    url?: string;
    snapshot?: { formattedTree: string; xpathMap: Record<string, string> };
    screenshot?: string;
  };
  fs?: ({ dir: string } | { file: string; base64: string } | { symlink: string; target: string })[];
  steps: ConformanceStep[];
  expect?: { closed?: boolean; tree?: string[]; files?: Record<string, string | { size: number }> };
};

const { sources, contract } = facadeBundle("conformance");
const casesDir = new URL("../conformance/cases/", import.meta.url);
const caseFiles = fs
  .readdirSync(casesDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

/** Expands the `$repeat` and `$sandbox` generators the case format allows in any JSON value. */
function expand(value: Json, sandbox: string): Json {
  if (Array.isArray(value)) return value.map((entry) => expand(entry, sandbox));
  if (value === null || typeof value !== "object") return value;
  if (typeof value.$repeat === "string") {
    return value.$repeat.repeat(value.count as number) + ((value.suffix as string) ?? "");
  }
  if (typeof value.$sandbox === "string") return path.join(sandbox, value.$sandbox);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, expand(entry, sandbox)]),
  );
}

function describeSentCall(source: string, input: unknown): Json {
  if (source === sources.actionRunner) return { callback: "actionRunner", input: input as Json };
  if (source.startsWith(sources.runPrelude) && source.endsWith(sources.runEpilogue)) {
    const code = source.slice(
      sources.runPrelude.length,
      source.length - sources.runEpilogue.length,
    );
    return { callback: "run", code };
  }
  return { callback: "unknown", source };
}

function createFakeStagehand(testCase: ConformanceCase, sandbox: string) {
  const state = {
    url: testCase.page?.url ?? "about:blank",
    snapshot: testCase.page?.snapshot ?? { formattedTree: "", xpathMap: {} },
    screenshotOptions: undefined as Json | undefined,
  };
  let scripted: ConformanceStep["batch"] = [];
  const sent: Json[] = [];
  const page = {
    pageId: "page-1",
    url: async () => state.url,
    snapshot: async () => state.snapshot,
    screenshot: async (options: Record<string, Json>) => {
      state.screenshotOptions = options;
      return Buffer.from(testCase.page?.screenshot ?? "", "base64");
    },
  };
  const context = {
    activePage: async () => page,
    pages: async () => [page],
    newPage: async () => page,
    setActivePage: async () => undefined,
  };
  const stagehand = {
    browser: { context, close: vi.fn(async () => undefined) },
    close: vi.fn(async () => undefined),
    experimentalBatch: async (callback: () => unknown, input: unknown) => {
      sent.push(describeSentCall(Function.prototype.toString.call(callback), input));
      const response = scripted.shift();
      if (response === undefined) throw new Error("conformance: unscripted batch call");
      if ("throw" in response) {
        throw Object.assign(new Error(response.throw.message), { name: response.throw.name });
      }
      return expand(response.return, sandbox);
    },
  };
  return {
    stagehand: stagehand as unknown as Stagehand,
    close: stagehand.close,
    state,
    sent,
    script(batch: ConformanceStep["batch"]) {
      scripted = [...batch];
      sent.length = 0;
    },
    unusedResponses: () => scripted.length,
  };
}

function callTool(tools: StagehandFacadeTools, call: ConformanceCall): Promise<unknown> {
  if (call.tool === "run") {
    return "code" in call
      ? tools.run(call.code)
      : tools.runActions(call.actions as Parameters<StagehandFacadeTools["runActions"]>[0]);
  }
  if (call.tool === "snapshot") return tools.snapshot({ includeIframes: call.includeIframes });
  const { tool: _, ...options } = call;
  return tools.screenshot(options);
}

function expectedMessage(error: ExpectedError): string | undefined {
  if (error.contractError === undefined) return error.message;
  let message = (contract.errors as Record<string, string>)[error.contractError];
  if (message === undefined) throw new Error(`Unknown contract error ${error.contractError}`);
  for (const [key, value] of Object.entries(error.params ?? {})) {
    message = message.replace(`\${${key}}`, value);
  }
  return message;
}

function expectError(actual: unknown, expected: ExpectedError): void {
  expect(actual).toBeInstanceOf(Error);
  const error = actual as Error & { facadeExecutionError?: boolean };
  switch (expected.kind) {
    case "input":
      expect(error).toBeInstanceOf(StagehandFacadeInputError);
      break;
    case "invalid":
      expect(error).toBeInstanceOf(ZodError);
      break;
    case "execution":
      expect(error.facadeExecutionError).toBe(true);
      break;
    case "batch":
      expect(error).not.toBeInstanceOf(StagehandFacadeInputError);
      expect(error.facadeExecutionError).toBeUndefined();
      break;
    case "syntax":
      expect(error.name).toBe("SyntaxError");
      break;
  }
  if (expected.name !== undefined) expect(error.name).toBe(expected.name);
  const message = expectedMessage(expected);
  if (message !== undefined) expect(error.message).toBe(message);
}

async function prepareSandbox(testCase: ConformanceCase, sandbox: string): Promise<void> {
  await fsp.mkdir(path.join(sandbox, "artifacts"));
  for (const entry of testCase.fs ?? []) {
    if ("dir" in entry) {
      await fsp.mkdir(path.join(sandbox, entry.dir), { recursive: true });
    } else if ("file" in entry) {
      await fsp.mkdir(path.dirname(path.join(sandbox, entry.file)), { recursive: true });
      await fsp.writeFile(path.join(sandbox, entry.file), Buffer.from(entry.base64, "base64"));
    } else {
      await fsp.symlink(entry.target, path.join(sandbox, entry.symlink));
    }
  }
}

/** Every entry under the sandbox without following symlinks: `dir/`, `link@`, `file`. */
async function listTree(sandbox: string, relative = ""): Promise<string[]> {
  const entries: string[] = [];
  for (const name of await fsp.readdir(path.join(sandbox, relative))) {
    const entry = relative ? `${relative}/${name}` : name;
    const stat = await fsp.lstat(path.join(sandbox, entry));
    if (stat.isSymbolicLink()) entries.push(`${entry}@`);
    else if (stat.isDirectory()) entries.push(`${entry}/`, ...(await listTree(sandbox, entry)));
    else entries.push(entry);
  }
  return entries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

describe("facade conformance (TypeScript host)", () => {
  const sandboxes: string[] = [];

  afterEach(async () => {
    await Promise.all(sandboxes.map((dir) => fsp.rm(dir, { recursive: true, force: true })));
    sandboxes.length = 0;
  });

  for (const file of caseFiles) {
    const { cases } = JSON.parse(fs.readFileSync(new URL(file, casesDir), "utf8")) as {
      cases: ConformanceCase[];
    };
    describe(file, () => {
      for (const testCase of cases) {
        const test = testCase.notApplicable?.typescript === undefined ? it : it.skip;
        test(testCase.name, { timeout: 60_000 }, async () => {
          const sandbox = await fsp.realpath(
            await fsp.mkdtemp(path.join(os.tmpdir(), "facade-conformance-")),
          );
          sandboxes.push(sandbox);
          await prepareSandbox(testCase, sandbox);
          const fake = createFakeStagehand(testCase, sandbox);
          const tools = new StagehandFacadeTools(fake.stagehand, {
            artifactRoot: path.join(sandbox, "artifacts"),
            keeperPage: false,
          });

          for (const [index, step] of testCase.steps.entries()) {
            if (step.pageUrl !== undefined) fake.state.url = step.pageUrl;
            if (step.snapshot !== undefined) fake.state.snapshot = step.snapshot;
            fake.state.screenshotOptions = undefined;
            fake.script(step.batch);
            const outcome = await callTool(tools, step.call).then(
              (result) => ({ result }),
              (error: unknown) => ({ error }),
            );
            const label = `step ${index}`;
            if ("result" in step.expect) {
              expect(outcome, label).toStrictEqual({ result: expand(step.expect.result, sandbox) });
            } else {
              expect(outcome, label).toHaveProperty("error");
              expectError((outcome as { error: unknown }).error, step.expect.error);
            }
            expect(fake.unusedResponses(), `${label} unused batch responses`).toBe(0);
            if (step.sent !== undefined) expect(fake.sent, label).toStrictEqual(step.sent);
            if (step.screenshotOptions !== undefined) {
              expect(fake.state.screenshotOptions, `${label} screenshot options`).toStrictEqual(
                step.screenshotOptions,
              );
            }
          }

          const expected = testCase.expect ?? {};
          if (expected.closed !== undefined) {
            expect(fake.close).toHaveBeenCalledTimes(expected.closed ? 1 : 0);
          }
          if (expected.tree !== undefined)
            expect(await listTree(sandbox)).toStrictEqual(expected.tree);
          for (const [file, content] of Object.entries(expected.files ?? {})) {
            const bytes = await fsp.readFile(path.join(sandbox, file));
            if (typeof content === "string") expect(bytes.toString("base64"), file).toBe(content);
            else expect(bytes.length, file).toBe(content.size);
          }
        });
      }
    });
  }
});
