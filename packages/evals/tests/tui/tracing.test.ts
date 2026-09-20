import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfig, TRACING_ENV_VARS } from "../../tui/commands/config.js";
import { handleTracing, resolveTracingValue } from "../../tui/commands/tracing.js";

const tempDirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

function makeTempEntryDir(tracing?: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-tracing-"));
  tempDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "evals.config.json"),
    JSON.stringify({ defaults: {}, benchmarks: {}, ...(tracing ? { tracing } : {}) }, null, 2),
  );
  return dir;
}

beforeEach(() => {
  for (const name of Object.values(TRACING_ENV_VARS)) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  process.exitCode = undefined;
});

afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  process.exitCode = undefined;
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("config tracing set/reset", () => {
  it("persists transport, braintrustProject and langsmithProject", async () => {
    const entryDir = makeTempEntryDir();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await handleTracing(["set", "transport", "OTEL"], entryDir);
    await handleTracing(["set", "braintrustProject", "team-evals"], entryDir);
    await handleTracing(["set", "langsmithProject", "ls-proj"], entryDir);

    expect(readConfig(entryDir).tracing).toEqual({
      transport: "otel",
      braintrustProject: "team-evals",
      langsmithProject: "ls-proj",
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("rejects an invalid transport and unknown keys without writing", async () => {
    const entryDir = makeTempEntryDir();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await handleTracing(["set", "transport", "jaeger"], entryDir);
    await handleTracing(["set", "apiKey", "sk-nope"], entryDir);

    expect(readConfig(entryDir).tracing).toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);
    expect(process.exitCode).toBe(1);
  });

  it("reset <key> prunes the key and reset with no key drops the section", async () => {
    const entryDir = makeTempEntryDir({ transport: "otel", braintrustProject: "x" });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await handleTracing(["reset", "braintrustProject"], entryDir);
    expect(readConfig(entryDir).tracing).toEqual({ transport: "otel" });

    await handleTracing(["reset"], entryDir);
    expect(readConfig(entryDir).tracing).toBeUndefined();
    expect(fs.readFileSync(path.join(entryDir, "evals.config.json"), "utf-8")).not.toContain(
      "tracing",
    );
  });

  it("does not touch other config sections", async () => {
    const entryDir = makeTempEntryDir();
    fs.writeFileSync(
      path.join(entryDir, "evals.config.json"),
      JSON.stringify({ defaults: { trials: 7 }, benchmarks: {}, core: { tool: "cdp_code" } }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    await handleTracing(["set", "transport", "otel"], entryDir);

    const config = readConfig(entryDir);
    expect(config.defaults).toEqual({ trials: 7 });
    expect(config.core).toEqual({ tool: "cdp_code" });
  });
});

describe("resolveTracingValue", () => {
  it("prefers env over config over nothing", () => {
    const tracing = { transport: "otel" as const, braintrustProject: "cfg" };
    expect(resolveTracingValue("transport", tracing, { EVAL_TRACE_TRANSPORT: "native" })).toEqual({
      value: "native",
      source: "env",
    });
    expect(resolveTracingValue("braintrustProject", tracing, {})).toEqual({
      value: "cfg",
      source: "config",
    });
    expect(resolveTracingValue("langsmithProject", tracing, {})).toEqual({
      value: undefined,
      source: "none",
    });
  });

  it("treats a blank env var as unset", () => {
    expect(
      resolveTracingValue(
        "braintrustProject",
        { braintrustProject: "cfg" },
        {
          BRAINTRUST_PROJECT_NAME: "   ",
        },
      ),
    ).toEqual({ value: "cfg", source: "config" });
  });
});
