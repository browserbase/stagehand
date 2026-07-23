import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BenchmarkManifestSchema,
  combinationInvalidReason,
} from "../../benchmarks/schema.js";
import { expandManifest, loadBenchmarksDir } from "../../benchmarks/expand.js";
import { getPackageRootDir } from "../../runtimePaths.js";

const BENCHMARKS_DIR = path.join(getPackageRootDir(), "benchmarks");

describe("benchmark manifest schema", () => {
  it("rejects unknown harnesses and surfaces", () => {
    const bad = BenchmarkManifestSchema.safeParse({
      name: "x",
      target: { kind: "tasks", include: ["act"] },
      matrix: {
        models: ["openai/gpt-4.1-mini"],
        harnesses: ["cursor"],
        toolSurfaces: ["v4_code"],
      },
    });
    expect(bad.success).toBe(false);
  });

  it("requires provider/model shape", () => {
    const bad = BenchmarkManifestSchema.safeParse({
      name: "x",
      target: { kind: "tasks", include: ["act"] },
      matrix: {
        models: ["gpt-4.1-mini"],
        harnesses: ["stagehand"],
        toolSurfaces: ["v4_code"],
      },
    });
    expect(bad.success).toBe(false);
  });
});

describe("combination validity", () => {
  it("stagehand harness pairs only with SDK code surfaces", () => {
    expect(combinationInvalidReason("stagehand", "understudy_code")).toBeNull();
    expect(combinationInvalidReason("stagehand", "v4_code")).toBeNull();
    expect(combinationInvalidReason("stagehand", "playwright_mcp")).toMatch(
      /stagehand/,
    );
  });

  it("external harnesses pair with any surface", () => {
    expect(
      combinationInvalidReason("claude_code", "playwright_mcp"),
    ).toBeNull();
    expect(combinationInvalidReason("codex", "v4_code")).toBeNull();
    expect(combinationInvalidReason("claude_code", "browse_cli")).toBeNull();
  });
});

describe("expansion", () => {
  it("expands the cross-product and reports skips with reasons", () => {
    const manifest = BenchmarkManifestSchema.parse({
      name: "t",
      target: { kind: "tasks", include: ["act/dropdown"] },
      matrix: {
        models: ["openai/gpt-4.1-mini", "anthropic/claude-haiku-4-5"],
        harnesses: ["stagehand", "claude_code"],
        toolSurfaces: ["v4_code", "playwright_mcp"],
      },
      trials: 2,
    });
    const { combinations, skipped } = expandManifest(manifest);
    // 2 models × (stagehand×{v4_code} + claude_code×{v4_code, playwright_mcp})
    expect(combinations).toHaveLength(6);
    expect(skipped).toHaveLength(2);
    expect(skipped[0].reason).toContain("stagehand");
    for (const c of combinations) {
      expect(c.trials).toBe(2);
      expect(c.benchmark).toBe("t");
    }
  });

  it("loads and expands the checked-in manifests", () => {
    const expanded = loadBenchmarksDir(BENCHMARKS_DIR);
    expect(expanded.length).toBeGreaterThanOrEqual(1);
    for (const bench of expanded) {
      expect(bench.combinations.length).toBeGreaterThan(0);
      for (const c of bench.combinations) {
        expect(combinationInvalidReason(c.harness, c.toolSurface)).toBeNull();
      }
    }
  });
});
