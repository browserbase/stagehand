import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeRubric } from "stagehand-v3";
import { buildHardBenchmarkTestcases } from "../../suites/hardbenchmark.js";

const dataset = readFileSync(
  new URL("../../datasets/hardbenchmark/HardBenchmark_data.jsonl", import.meta.url),
  "utf8",
);
const rows = dataset
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const manifest = JSON.parse(
  readFileSync(new URL("../../datasets/hardbenchmark/manifest.json", import.meta.url), "utf8"),
);
const build = () => buildHardBenchmarkTestcases(["openai/gpt-4.1-mini"]);

beforeEach(() => {
  for (const key of [
    "EVAL_MAX_K",
    "EVAL_HARDBENCHMARK_SET",
    "EVAL_HARDBENCHMARK_LIMIT",
    "EVAL_HARDBENCHMARK_SAMPLE",
    "EVAL_HARDBENCHMARK_IDS",
    "EVAL_HARDBENCHMARK_MODE",
  ])
    vi.stubEnv(key, undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("HardBench frozen corpus and selection", () => {
  it("preserves the reviewed corpus bytes, IDs, set membership and valid rubrics", () => {
    expect(createHash("sha256").update(dataset).digest("hex")).toBe(
      "2eca8e697d40c7d3f4179af3aea3a4aa620843a6bc55ba9fcbd088592668ce5a",
    );
    expect(manifest.sha256).toBe(createHash("sha256").update(dataset).digest("hex"));
    expect(rows).toHaveLength(158);
    expect(new Set(rows.map((row) => row.id)).size).toBe(158);
    for (const [set, count] of Object.entries({
      core: 38,
      extended: 64,
      holdout: 20,
      retired: 33,
      quarantined: 3,
    })) {
      const members = rows.filter((row) => row.set === set);
      expect(members).toHaveLength(count);
      expect(manifest.sets[set]).toEqual(members.map((row) => row.id));
      expect(
        members.every((row) => (row.valid === false) === ["retired", "quarantined"].includes(set)),
      ).toBe(true);
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
    expect(rows.filter((row) => row.rubric_version === "1.2")).toHaveLength(149);
  });

  it.each([
    [undefined, 38],
    ["core", 38],
    ["extended", 102],
    ["all", 102],
    ["holdout", 20],
  ])("selects %s with no implicit cap", (set, count) => {
    vi.stubEnv("EVAL_HARDBENCHMARK_SET", set);
    const cases = build();
    expect(cases).toHaveLength(count);
    expect(cases.some((c) => c.metadata.bench_tier === "holdout")).toBe(set === "holdout");
  });

  it("carries the exact normalized rubric and provenance to each model", () => {
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

  it("rejects unknown, inactive and duplicate resolved IDs", () => {
    for (const ids of ["typo", rows.find((row) => row.valid === false).id]) {
      vi.stubEnv("EVAL_HARDBENCHMARK_IDS", ids);
      expect(build).toThrow(/Unknown or inactive/);
    }
    const row = rows.find((r) => r.set === "core" && r.slug);
    vi.stubEnv("EVAL_HARDBENCHMARK_IDS", `${row.id},${row.slug}`);
    expect(build).toThrow(/Duplicate/);
  });

  it("validates set and numeric knobs, gives EVAL_MAX_K precedence, and samples without duplication", () => {
    for (const set of ["typo", "toString", "constructor"]) {
      vi.stubEnv("EVAL_HARDBENCHMARK_SET", set);
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
});
