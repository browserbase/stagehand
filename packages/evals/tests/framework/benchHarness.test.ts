import { describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import {
  claudeCodeHarness,
  codexHarness,
  getBenchHarness,
  isExecutableBenchHarness,
  listBenchHarnesses,
  parseBenchHarness,
  registerBenchHarness,
} from "../../framework/benchHarness.js";

describe("bench harness registry", () => {
  it("lists registered harnesses in registration order", () => {
    expect(listBenchHarnesses()).toEqual(["stagehand", "claude_code", "codex"]);
  });

  it("parses registered harnesses and defaults to stagehand", () => {
    expect(parseBenchHarness(undefined)).toBe("stagehand");
    expect(parseBenchHarness("codex")).toBe("codex");
    expect(() => parseBenchHarness("nope")).toThrow(
      /Unknown harness "nope"\. Supported: stagehand, claude_code, codex\./,
    );
  });

  it("reports whether a harness is executable", () => {
    expect(isExecutableBenchHarness("claude_code")).toBe(true);
    expect(isExecutableBenchHarness("nope")).toBe(false);
  });

  it("registers claude_code as a concrete executable harness", () => {
    const harness = getBenchHarness("claude_code");

    expect(harness).toBe(claudeCodeHarness);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
    expect(harness.supportedToolSurfaces[0]).toBe("browse_cli");
    expect(harness.defaultModels).toEqual(["anthropic/claude-sonnet-4-6"]);
  });

  it("registers codex as a concrete executable harness", () => {
    const harness = getBenchHarness("codex");

    expect(harness).toBe(codexHarness);
    expect(harness.supportedTaskKinds).toEqual(["agent", "suite"]);
    expect(harness.supportsApi).toBe(false);
    expect(harness.execute).toBeDefined();
    expect(harness.defaultModels).toEqual(["openai/gpt-5.4-mini"]);
  });

  it("registers a new harness and rejects duplicate ids", () => {
    const fakeHarness = {
      harness: "fake_harness",
      supportedTaskKinds: ["suite" as const],
      supportsApi: false,
      supportedToolSurfaces: ["browse_cli" as const],
      defaultModels: ["openai/x" as AvailableModel],
      execute: async () => ({ _success: true }),
      start: async () => {
        throw new Error("n/a");
      },
    };

    registerBenchHarness(fakeHarness);
    expect(parseBenchHarness("fake_harness")).toBe("fake_harness");
    expect(() => registerBenchHarness(fakeHarness)).toThrow(/already registered/);
  });
});
