import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeRubric } from "stagehand-v3";
import { EvalsError } from "../../errors.js";
import { buildHardBenchmarkTestcases } from "../../suites/hardbenchmark.js";

const dataset = readFileSync(
  new URL("../../datasets/hardbenchmark/HardBenchmark_data.jsonl", import.meta.url),
  "utf8",
);
const rows = dataset
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const build = () => buildHardBenchmarkTestcases(["openai/gpt-4.1-mini"]);

beforeEach(() => {
  for (const key of [
    "EVAL_MAX_K",
    "EVAL_HARDBENCHMARK_SET",
    "EVAL_HARDBENCHMARK_LIMIT",
    "EVAL_HARDBENCHMARK_SAMPLE",
    "EVAL_HARDBENCHMARK_IDS",
  ])
    vi.stubEnv(key, undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("HardBench corpus and selection", () => {
  it("contains unique active tasks with valid rubrics in the three tiers", () => {
    expect(rows).toHaveLength(122);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    for (const [set, count] of Object.entries({ core: 38, extended: 64, holdout: 20 })) {
      expect(rows.filter((row) => row.set === set)).toHaveLength(count);
    }
    for (const row of rows) {
      const rubric = normalizeRubric(row.precomputed_rubric);
      expect(rubric?.items.length).toBeGreaterThan(0);
      expect(
        rubric?.items.every(
          (item) => item.description && Number.isFinite(item.maxPoints) && item.maxPoints > 0,
        ),
      ).toBe(true);
    }
  });

  it.each([
    [undefined, 38],
    ["core", 38],
    ["extended", 102],
    ["holdout", 20],
  ])("selects %s with no implicit cap", (set, count) => {
    vi.stubEnv("EVAL_HARDBENCHMARK_SET", set);
    const cases = build();
    expect(cases).toHaveLength(count);
    expect(cases.some((c) => c.metadata.bench_tier === "holdout")).toBe(set === "holdout");
  });

  it("carries the exact normalized rubric and rubric metadata to each model", () => {
    const cases = buildHardBenchmarkTestcases(["openai/gpt-4.1-mini", "openai/gpt-4.1"]);
    expect(cases).toHaveLength(76);
    for (const c of cases) {
      const row = rows.find((r) => r.id === c.metadata.task_id);
      expect(c.input.params?.ques).toBe(row.ques);
      expect(c.input.params?.precomputed_rubric).toEqual(normalizeRubric(row.precomputed_rubric));
      expect(c.metadata.rubric_version).toBe(row.rubric_version);
      expect(c.metadata.clarifications).toEqual(row.clarifications);
      expect(c.metadata.category).toBe("external_agent_benchmarks");
    }
  });

  it("allows deliberate holdout selection by slug/ID in requested order, overriding set/limit", () => {
    const holdout = rows.find((row) => row.set === "holdout");
    const core = rows.find((row) => row.set === "core");
    vi.stubEnv("EVAL_HARDBENCHMARK_IDS", `${holdout.slug},${core.id}`);
    vi.stubEnv("EVAL_HARDBENCHMARK_LIMIT", "1");
    expect(build().map((c) => c.metadata.task_id)).toEqual([holdout.id, core.id]);
  });

  it("rejects unknown and duplicate resolved IDs", () => {
    vi.stubEnv("EVAL_HARDBENCHMARK_IDS", "unknown-task");
    expect(build).toThrow(EvalsError);
    expect(build).toThrow(/Unknown/);
    const row = rows.find((r) => r.set === "core" && r.slug);
    vi.stubEnv("EVAL_HARDBENCHMARK_IDS", `${row.id},${row.slug}`);
    expect(build).toThrow(/Duplicate/);
  });

  it("validates set and numeric knobs, gives EVAL_MAX_K precedence, and samples without duplication", () => {
    for (const set of ["all", "typo", "toString", "constructor"]) {
      vi.stubEnv("EVAL_HARDBENCHMARK_SET", set);
      expect(build).toThrow(EvalsError);
      expect(build).toThrow(/must be one of/);
    }
    vi.stubEnv("EVAL_HARDBENCHMARK_SET", "core");
    for (const key of ["EVAL_MAX_K", "EVAL_HARDBENCHMARK_LIMIT", "EVAL_HARDBENCHMARK_SAMPLE"]) {
      for (const value of ["0", "-1", "1.5", "NaN", "", "3bad"]) {
        vi.stubEnv(key, value);
        expect(build).toThrow(/positive integer/);
      }
      vi.stubEnv(key, undefined);
    }
    vi.stubEnv("EVAL_MAX_K", "4");
    vi.stubEnv("EVAL_HARDBENCHMARK_LIMIT", "2");
    expect(build()).toHaveLength(4);
    vi.stubEnv("EVAL_HARDBENCHMARK_SAMPLE", "3");
    const cases = build();
    expect(cases).toHaveLength(3);
    expect(new Set(cases.map((c) => c.metadata.task_id)).size).toBe(3);
  });

  it.each(["EVAL_MAX_K", "EVAL_HARDBENCHMARK_LIMIT"])(
    "caps a larger requested sample with %s",
    (key) => {
      vi.stubEnv(key, "2");
      vi.stubEnv("EVAL_HARDBENCHMARK_SAMPLE", "10");
      const cases = build();
      expect(cases).toHaveLength(2);
      expect(new Set(cases.map((c) => c.metadata.task_id)).size).toBe(2);
    },
  );

  it.each(["EVAL_HARDBENCHMARK_SET", "EVAL_HARDBENCHMARK_IDS", "EVAL_MAX_K"])(
    "does not reflect arbitrary environment values from %s in errors",
    (key) => {
      vi.stubEnv(key, "https://example.com?apiKey=private-value");
      expect(build).toThrow(EvalsError);
      try {
        build();
      } catch (error) {
        expect(String(error)).not.toContain("private-value");
      }
    },
  );
});
