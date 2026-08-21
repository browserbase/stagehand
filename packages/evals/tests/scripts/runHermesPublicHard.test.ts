import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const validateHermesBenchmarkRoot = vi.fn((candidate: string) => path.resolve(candidate));
const runHermesAgent = vi.fn(() => {
  throw new Error("dry-run gate launched Hermes");
});

vi.mock("../../framework/hermesRunner.js", () => ({
  validateHermesBenchmarkRoot,
  runHermesAgent,
}));

const originalArgv = [...process.argv];
const originalExitCode = process.exitCode;
const managedEnvironment = [
  "AI_GATEWAY_API_KEY",
  "BROWSERBASE_API_KEY",
  "EVAL_HERMES_ROOT",
  "EVAL_RUBRIC_CACHE_ROOT",
] as const;
const originalEnvironment = Object.fromEntries(
  managedEnvironment.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  process.argv = [...originalArgv];
  process.exitCode = originalExitCode;
  for (const key of managedEnvironment) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  validateHermesBenchmarkRoot.mockClear();
  runHermesAgent.mockClear();
});

interface ScriptResult {
  stdout: string;
  stderr: string;
  exitCode: string | number | null | undefined;
}

async function runScript(
  args: string[],
  options: { gatewayCatalog?: boolean } = {},
): Promise<ScriptResult> {
  vi.resetModules();
  process.argv = [process.execPath, "run-hermes-public-hard.ts", ...args];
  process.exitCode = undefined;
  process.env.EVAL_HERMES_ROOT = "/tmp/non-billable-hermes-fixture";
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.BROWSERBASE_API_KEY;
  delete process.env.EVAL_RUBRIC_CACHE_ROOT;

  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);

  if (options.gatewayCatalog) {
    process.env.AI_GATEWAY_API_KEY = "non-secret-test-value";
    process.env.BROWSERBASE_API_KEY = "non-secret-test-value";
    process.env.EVAL_RUBRIC_CACHE_ROOT = "/tmp/non-billable-rubric-cache";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "anthropic/claude-opus-4.8",
              type: "language",
              tags: ["tool-use"],
              pricing: { input: "0.000001", output: "0.000002" },
            },
            {
              id: "moonshotai/kimi-k3",
              type: "language",
              tags: ["tool-use"],
              pricing: { input: "0.000001", output: "0.000002" },
            },
          ],
        }),
      })),
    );
  } else {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("dry-run attempted a network request");
      }),
    );
  }

  try {
    await import("../../scripts/run-hermes-public-hard.js");
    await new Promise((resolve) => setImmediate(resolve));
    return {
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      exitCode: process.exitCode,
    };
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

describe("run-hermes-public-hard non-billable gates", () => {
  it.each([
    ["canary", 3],
    ["full", 30],
  ])(
    "prints the exact %s dry-run schedule without credentials or runtime calls",
    async (phase, count) => {
      const output = fs.mkdtempSync(path.join(os.tmpdir(), `hermes-${phase}-dry-run-`));
      fs.rmSync(output, { recursive: true, force: true });
      try {
        const result = await runScript(["--phase", phase, "--dry-run", "--output", output]);

        expect(result.exitCode).toBeUndefined();
        expect(result.stderr).toBe("");
        const payload = JSON.parse(result.stdout) as {
          dry_run: boolean;
          phase: string;
          rows: Array<{ arm: string }>;
          model_calls: number;
          browser_sessions: number;
        };
        expect(payload.dry_run).toBe(true);
        expect(payload.phase).toBe(phase);
        expect(payload.rows).toHaveLength(count);
        expect(new Set(payload.rows.map((row) => row.arm))).toEqual(new Set(["A", "B", "D"]));
        expect(payload.model_calls).toBe(0);
        expect(payload.browser_sessions).toBe(0);
        expect(runHermesAgent).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(fs.existsSync(output)).toBe(false);
      } finally {
        fs.rmSync(output, { recursive: true, force: true });
      }
    },
  );

  it("requires exactly one explicit billing mode", async () => {
    const missing = await runScript(["--phase", "canary"]);
    expect(missing.exitCode).toBe(4);
    expect(missing.stderr).toContain("Choose exactly one of --dry-run or --confirm-billable");

    const conflicting = await runScript(["--phase", "canary", "--dry-run", "--confirm-billable"]);
    expect(conflicting.exitCode).toBe(4);
    expect(conflicting.stderr).toContain("Choose exactly one of --dry-run or --confirm-billable");
    expect(runHermesAgent).not.toHaveBeenCalled();
  });

  it("rejects a full run without a complete canary before creating output", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-full-gate-"));
    const canary = path.join(root, "empty-canary");
    const output = path.join(root, "full-output");
    fs.mkdirSync(canary);
    try {
      const result = await runScript(
        ["--phase", "full", "--confirm-billable", "--canary-root", canary, "--output", output],
        { gatewayCatalog: true },
      );

      expect(result.exitCode).toBe(4);
      expect(result.stderr).toContain("Canary record is missing for arm A");
      expect(runHermesAgent).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(output)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
