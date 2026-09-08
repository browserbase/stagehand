import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VERIFIER_MODEL } from "../../framework/verifierAdapter.js";
import { handleVerify } from "../../tui/commands/verify.js";

const state = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  result: {} as Record<string, unknown>,
  key: "fixture-key" as string | undefined,
}));

vi.mock("stagehand-v3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stagehand-v3")>();
  return {
    ...actual,
    V3: class {},
    V3Evaluator: class {
      constructor(_v3: unknown, options: Record<string, unknown>) {
        state.options.push(options);
      }
      async verify() {
        return state.result;
      }
    },
    loadApiKeyFromEnv: () => state.key,
    loadTrajectoryFromDisk: async () => ({
      task: { id: "fixture", instruction: "Inspect the page" },
      status: "complete",
      steps: [] as unknown[],
    }),
    nextResultFilename: () => "result_fixture.json",
  };
});

describe("offline verifier command", () => {
  let dir: string;
  let previousExitCode: typeof process.exitCode;
  let output: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "offline-verifier-"));
    await fs.writeFile(path.join(dir, "trajectory.json"), "{}");
    state.options = [];
    state.result = { outcomeSuccess: true, processScore: 1 };
    state.key = "fixture-key";
    output = "";
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.stubEnv("EVAL_VERIFIER_MODEL", "");
    vi.stubEnv("EVAL_VERIFIER_TRACE", "0");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
  });

  afterEach(async () => {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it.each([
    { env: "", args: [], expected: DEFAULT_VERIFIER_MODEL },
    { env: "google/fixture-environment", args: [], expected: "google/fixture-environment" },
    {
      env: "google/fixture-environment",
      args: ["--model", "anthropic/fixture-cli"],
      expected: "anthropic/fixture-cli",
    },
  ])("uses shared model policy: $expected", async ({ env, args, expected }) => {
    vi.stubEnv("EVAL_VERIFIER_MODEL", env);
    await handleVerify([dir, ...args, "--json"]);
    expect(state.options).toEqual([
      { backend: "verifier", modelName: expected, modelClientOptions: { apiKey: "fixture-key" } },
    ]);
  });

  it("rejects an explicit CLI model without its provider key", async () => {
    state.key = undefined;
    await expect(handleVerify([dir, "--model", "anthropic/fixture-cli", "--json"])).rejects.toThrow(
      "no API key",
    );
    expect(state.options).toEqual([]);
  });

  it("emits uncertainty as ungraded JSON while retaining the raw judge evidence", async () => {
    state.result = {
      outcomeSuccess: false,
      processScore: 0,
      findings: [{ category: "verifier_uncertainty", description: "provider unavailable" }],
    };
    await handleVerify([dir, "--json"]);
    const result = JSON.parse(output);
    expect(result).toMatchObject({ graded: false, judge: state.result });
    expect(result.verifierError).toContain("uncertainty");
    expect(result).not.toHaveProperty("outcomeSuccess");
    expect(result).not.toHaveProperty("processScore");
    expect(process.exitCode).toBe(1);
    await expect(fs.stat(path.join(dir, "scores"))).rejects.toThrow();
  });

  it("persists an auditable ungraded result for human output", async () => {
    state.result = {
      outcomeSuccess: false,
      processScore: 0,
      findings: [{ category: "verifier_uncertainty", description: "provider unavailable" }],
    };
    await handleVerify([dir]);
    const result = JSON.parse(
      await fs.readFile(path.join(dir, "scores/result_fixture.json"), "utf8"),
    );
    expect(result).toMatchObject({ graded: false, judge: state.result });
    expect(result).not.toHaveProperty("outcomeSuccess");
    expect(process.exitCode).toBe(1);
  });

  it("keeps a trustworthy failed verdict scored", async () => {
    state.result = { outcomeSuccess: false, processScore: 0 };
    await handleVerify([dir, "--json"]);
    expect(JSON.parse(output)).toMatchObject({ outcomeSuccess: false, processScore: 0 });
    expect(JSON.parse(output)).not.toHaveProperty("verifierError");
    expect(process.exitCode).toBeUndefined();
  });

  it("does not persist uncertainty in dry-run mode", async () => {
    state.result = {
      outcomeSuccess: false,
      processScore: 0,
      findings: [{ category: "verifier_uncertainty", description: "provider unavailable" }],
    };
    await handleVerify([dir, "--dry-run"]);
    expect(process.exitCode).toBe(1);
    await expect(fs.stat(path.join(dir, "scores"))).rejects.toThrow();
  });
});
