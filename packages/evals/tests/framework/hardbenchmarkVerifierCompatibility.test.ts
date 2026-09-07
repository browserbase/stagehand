import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvaluationResult, Rubric } from "stagehand-v3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertVerifiedResult,
  runCompatibilityGate,
} from "../../scripts/verify-hardbenchmark-compatibility.js";
import manifest from "../fixtures/hardbenchmark-compatibility/manifest.json" with { type: "json" };

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const dataset = path.join(repo, "packages/evals/datasets/hardbenchmark/HardBenchmark_data.jsonl");
const fixtures = path.join(
  repo,
  "packages/evals/tests/fixtures/hardbenchmark-compatibility/manifest.json",
);
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function fixture(id: string) {
  return manifest.live.find((row) => row.id === id)!;
}
const rubric: Rubric = {
  items: [
    {
      criterion: "Selected frozen criterion",
      description: "Evidence supports the process",
      maxPoints: 4,
    },
  ],
};
function verdict(processScore = 1): EvaluationResult {
  return {
    outcomeSuccess: false,
    processScore,
    perCriterion: [
      { criterion: rubric.items[0].criterion, maxPoints: 4, earnedPoints: processScore * 4 },
    ],
    rawSteps: { rubricSource: "precomputed" },
    findings: [],
  } as EvaluationResult;
}

describe("HardBench real V3 verifier compatibility", () => {
  it("preserves all original task, observation, answer, rubric-slice and outcome fields", () => {
    const stripPolicy = (rows: typeof manifest.live | typeof manifest.offline) =>
      rows.map(({ expectedProcess: _policy, ...original }) => original);
    const original = { offline: stripPolicy(manifest.offline), live: stripPolicy(manifest.live) };
    expect(createHash("sha256").update(JSON.stringify(original)).digest("hex")).toBe(
      "000449c0d4bb056ed39cca0468db1ee745b23eb22dcbfc7fd15a197b57f6324f",
    );
    expect(manifest.live).toHaveLength(12);
    expect(manifest.live.every((row) => row.expectedProcess.rationale.length > 0)).toBe(true);
  });

  it("scores a full real v1.2 rubric, overrides opposite self-reports, persists results and rejects provider/schema faults", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "hardbench-verifier-"));
    dirs.push(parent);
    const out = path.join(parent, "report");
    const originalFetch = globalThis.fetch;
    const report = await runCompatibilityGate({ repo, dataset, fixtures, out });
    expect(report.passed).toBe(true);
    expect(report.sdkVersion).toBe("3.7.1");
    expect(report.cases).toHaveLength(4);
    expect(report.cases.map((c) => c.accepted)).toEqual([true, true, false, false]);
    expect(report.cases.slice(2).every((c) => c.faultRejected)).toBe(true);
    expect(globalThis.fetch).toBe(originalFetch);
    const requests = JSON.parse(await readFile(path.join(out, "requests.json"), "utf8"));
    expect(requests.length).toBeGreaterThan(4);
    expect(
      requests.every((r: { schema: string }) =>
        ["BatchedRelevance", "FusedJudgment"].includes(r.schema),
      ),
    ).toBe(true);
  }, 30_000);

  it.each(["fallback-negative", "park-deliverable-negative"])(
    "allows false outcome plus full process credit where declared: %s",
    (id) => {
      expect(() =>
        assertVerifiedResult({ _success: false }, verdict(), rubric, fixture(id)),
      ).not.toThrow();
      expect(() =>
        assertVerifiedResult(
          { _success: true },
          { ...verdict(), outcomeSuccess: true },
          rubric,
          fixture(id),
        ),
      ).toThrow("verified outcome mismatch");
    },
  );

  it.each([
    "relative-date-negative",
    "table-format-negative",
    "source-authority-negative",
    "critical-point-negative",
  ])("rejects full process credit for a violated selected criterion: %s", (id) => {
    expect(() => assertVerifiedResult({ _success: false }, verdict(), rubric, fixture(id))).toThrow(
      "process score outside fixture expectation",
    );
    expect(() =>
      assertVerifiedResult({ _success: false }, verdict(0.5), rubric, fixture(id)),
    ).not.toThrow();
  });

  it("requires an explicit independent process policy", () => {
    expect(() =>
      assertVerifiedResult({ _success: false }, verdict(), rubric, {
        expectedOutcome: false,
        expectedProcess: undefined,
      }),
    ).toThrow("independent process expectations");
  });

  it("never accepts verifier errors, insufficient evidence or uncertainty sentinels under permissive process bounds", () => {
    const expected = fixture("fallback-negative");
    expect(() =>
      assertVerifiedResult(
        { _success: false, verifierError: "unavailable" },
        undefined,
        rubric,
        expected,
      ),
    ).toThrow(/verifierError/);
    const insufficient = verdict();
    insufficient.perCriterion[0].evidenceInsufficient = true;
    expect(() => assertVerifiedResult({ _success: false }, insufficient, rubric, expected)).toThrow(
      "insufficient evidence",
    );
    const uncertain = verdict();
    uncertain.findings = [{ category: "verifier_uncertainty" }] as EvaluationResult["findings"];
    expect(() => assertVerifiedResult({ _success: false }, uncertain, rubric, expected)).toThrow(
      "uncertainty/default result",
    );
    expect(() =>
      assertVerifiedResult(
        { _success: false },
        { ...verdict(), processScore: NaN },
        rubric,
        expected,
      ),
    ).toThrow("invalid process score");
  });

  it("records real Google V3 requests before forwarding to a local provider stub, without credentials in evidence", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "hardbench-google-verifier-"));
    dirs.push(parent);
    const out = path.join(parent, "report");
    const selected = fixture("table-format-positive");
    const fixturePath = path.join(parent, "fixture.json");
    await writeFile(fixturePath, JSON.stringify({ ...manifest, live: [selected] }));
    const key = "synthetic-google-gate-key";
    vi.stubEnv("GEMINI_API_KEY", key);
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      );
      expect(request.headers.get("x-goog-api-key")).toBe(key);
      const body = await request.json();
      const properties = body.generationConfig.responseSchema.properties;
      const data = properties.per_criterion
        ? {
            outcome: {
              primary_intent: "Compare prices",
              reasoning: "Both retailers, URLs and prices appear in the table",
              output_success: true,
              findings: [] as unknown[],
            },
            per_criterion: [
              {
                criterion_idx: 0,
                applicable_evidence: selected.observation,
                justification: "The table contains all required fields",
                earned_points: 4,
                evidence_sufficient: true,
              },
            ],
            task_validity: { is_ambiguous: false, is_invalid: false },
          }
        : {
            items: [
              ...new Set(
                [...JSON.stringify(body).matchAll(/evidence_idx=(\d+)/g)].map((match) =>
                  Number(match[1]),
                ),
              ),
            ].map((evidence_idx) => ({ evidence_idx, scores: [{ criterion_idx: 0, score: 10 }] })),
          };
      // Persisted before the stub sees the request, even if the provider later fails.
      expect((await readdir(path.join(out, "requests"))).length).toBe(transport.mock.calls.length);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { role: "model", parts: [{ text: JSON.stringify(data) }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", transport);
    const report = await runCompatibilityGate({
      repo,
      dataset,
      fixtures: fixturePath,
      out,
      live: true,
      judgeModel: "google/gemini-2.5-flash",
    });
    expect(report.passed, JSON.stringify(report.cases)).toBe(true);
    expect(report.cases[0].requestCount).toBeGreaterThan(0);
    expect(transport).toHaveBeenCalled();
    const requestsText = await readFile(path.join(out, "requests.json"), "utf8");
    const requests = JSON.parse(requestsText);
    expect(requests.every((entry: { captureVersion: number }) => entry.captureVersion === 1)).toBe(
      true,
    );
    expect(requestsText).not.toContain(key);
    expect(requestsText).not.toContain("x-goog-api-key");
    expect(globalThis.fetch).toBe(transport);
  }, 30_000);
});
