/**
 * Bounded V3 compatibility gate. No browser or rubric generation. Offline mode
 * replaces only fetch, exercises the real V3 evaluator/adapter, and blocks all
 * outgoing requests. Live mode must be explicitly requested with --live and a
 * judge model; it reads environment keys only (no dotenv).
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import type { Rubric, Trajectory, EvaluationResult } from "stagehand-v3";
import type { TaskResult } from "../framework/types.js";
import type { EvalLogger } from "../logger.js";
import {
  createLiveVerifierFetch,
  assertVerifierEndpoint,
  verifierRequestSchema,
  HardBenchmarkGateError,
  sanitizeGateError,
  type VerifierRequestEvidence,
} from "./hardbenchmark-request-evidence.js";

export type ProcessExpectation = {
  min: number;
  max: number;
  rationale: string;
  minExclusive?: boolean;
  maxExclusive?: boolean;
};

type Fixture = {
  id: string;
  taskId: string;
  criterionIndices?: number[];
  instruction?: string;
  observation: string;
  answer: string;
  expectedOutcome: boolean;
  expectedProcess: ProcessExpectation;
  baseSuccess: boolean;
  transport?: "schema-error" | "provider-error";
};
type GateOptions = {
  repo: string;
  dataset: string;
  fixtures: string;
  out: string;
  live?: boolean;
  judgeModel?: string;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new HardBenchmarkGateError(message);
}

/** Reject both adapter errors and V3's synthesized evidence-insufficient result. */
export function assertVerifiedResult(
  result: TaskResult,
  verdict: EvaluationResult,
  rubric: Rubric,
  expected: Pick<Fixture, "expectedOutcome" | "expectedProcess">,
) {
  assert(!result.verifierError, `verifierError: ${sanitizeGateError(result.verifierError)}`);
  assert(verdict?.rawSteps?.rubricSource === "precomputed", "rubric was not precomputed");
  assert(typeof verdict.outcomeSuccess === "boolean", "missing boolean verdict");
  assert(
    verdict.outcomeSuccess === expected.expectedOutcome &&
      result._success === expected.expectedOutcome,
    "verified outcome mismatch",
  );
  assert(
    Array.isArray(verdict.perCriterion) && verdict.perCriterion.length === rubric.items.length,
    "criterion count mismatch",
  );
  assert(
    Number.isFinite(verdict.processScore) && verdict.processScore >= 0 && verdict.processScore <= 1,
    "invalid process score",
  );
  assert(
    !verdict.findings?.some((f) => f.category === "verifier_uncertainty"),
    "verifier returned an uncertainty/default result",
  );
  let earned = 0;
  let max = 0;
  for (const [i, score] of verdict.perCriterion.entries()) {
    const item = rubric.items[i];
    assert(
      score.criterion === item.criterion && score.maxPoints === item.maxPoints,
      `criterion ${i} identity/maxPoints mismatch`,
    );
    assert(
      typeof score.earnedPoints === "number" &&
        Number.isFinite(score.earnedPoints) &&
        score.earnedPoints >= 0 &&
        score.earnedPoints <= score.maxPoints,
      `criterion ${i} missing/invalid points`,
    );
    assert(!score.evidenceInsufficient, `criterion ${i} has insufficient evidence`);
    earned += score.earnedPoints;
    max += score.maxPoints;
  }
  assert(
    max > 0 && Math.abs(verdict.processScore - earned / max) < 1e-9,
    "process score is not rubric point arithmetic",
  );
  const bounds = expected.expectedProcess;
  assert(
    bounds &&
      Number.isFinite(bounds.min) &&
      Number.isFinite(bounds.max) &&
      bounds.min >= 0 &&
      bounds.max <= 1 &&
      bounds.min <= bounds.max &&
      typeof bounds.rationale === "string" &&
      bounds.rationale.trim().length > 0,
    "fixture must declare valid independent process expectations",
  );
  assert(
    (bounds.minExclusive
      ? verdict.processScore > bounds.min
      : verdict.processScore >= bounds.min) &&
      (bounds.maxExclusive
        ? verdict.processScore < bounds.max
        : verdict.processScore <= bounds.max),
    "process score outside fixture expectation",
  );
}

export async function runCompatibilityGate(options: GateOptions) {
  const repo = path.resolve(options.repo);
  const dataset = await readFile(options.dataset, "utf8");
  const fixtureText = await readFile(options.fixtures, "utf8");
  const fixtureManifest = JSON.parse(fixtureText) as { offline: Fixture[]; live: Fixture[] };
  const fixtures = options.live ? fixtureManifest.live : fixtureManifest.offline;
  assert(
    fixtures?.length > 0 && new Set(fixtures.map((f) => f.id)).size === fixtures.length,
    "fixtures must be nonempty with unique IDs",
  );
  const rows = new Map(
    dataset
      .trim()
      .split("\n")
      .map((line) => {
        const row = JSON.parse(line);
        return [row.id, row];
      }),
  );
  const sdkPath = path.join(repo, "packages/evals/node_modules/stagehand-v3");
  const sdk = (await import(
    pathToFileURL(path.join(sdkPath, "dist/esm/index.js")).href
  )) as typeof import("stagehand-v3");
  const adapterPath = path.join(repo, "packages/evals/framework/verifierAdapter.ts");
  const adapter = (await import(
    pathToFileURL(adapterPath).href
  )) as typeof import("../framework/verifierAdapter.js");
  const model = options.live ? options.judgeModel : "openai/gpt-4.1-mini";
  assert(model && model.includes("/"), "--live requires explicit --judge-model provider/model");
  const provider = model.split("/")[0];
  let judgeApiKey: string | undefined;
  if (options.live) {
    judgeApiKey = sdk.loadApiKeyFromEnv(provider, () => {});
    assert(
      judgeApiKey,
      `Missing judge credentials for ${provider}; set its API key in the environment (no .env is loaded).`,
    );
  }
  // Restore every modified variable and fetch even if a gate assertion fails.
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const requests: (VerifierRequestEvidence & { caseId: string })[] = [];
  const reports: Record<string, unknown>[] = [];
  let active: Fixture;
  let activeRubric: Rubric;
  let transportFailures = 0;
  await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
  await mkdir(options.out); // Evidence outputs are immutable: choose a new directory for each run.
  try {
    for (const key of Object.keys(process.env))
      if (
        key.startsWith("VERIFIER_") ||
        [
          "BRAINTRUST_API_KEY",
          "LANGSMITH_API_KEY",
          "LANGCHAIN_API_KEY",
          "EVAL_TRAJECTORY_GROUP",
          "EVAL_EXPERIMENT_NAME",
          "EVAL_TRAJECTORY_MODEL",
        ].includes(key)
      )
        delete process.env[key];
    Object.assign(process.env, {
      EVAL_TRACE_TRANSPORT: "native",
      EVAL_VERIFIER_MODEL: model,
      VERIFIER_APPROACH: "b",
      VERIFIER_OPTIONAL_STEPS: "folded",
      VERIFIER_PERSIST_TRAJECTORIES: "1",
      VERIFIER_DISABLE_RUBRIC_CACHE: "1",
    });
    if (options.live) {
      await mkdir(path.join(options.out, "requests"));
      globalThis.fetch = createLiveVerifierFetch({
        provider,
        fetchImpl: originalFetch,
        redactValues: judgeApiKey ? [judgeApiKey] : [],
        onRequest: async (evidence) => {
          const entry = { caseId: active.id, ...evidence };
          requests.push(entry);
          const index = requests.length;
          await writeFile(
            path.join(options.out, "requests", `${String(index).padStart(4, "0")}.json`),
            JSON.stringify(entry, null, 2) + "\n",
            { flag: "wx" },
          );
        },
      });
    } else {
      process.env.OPENAI_API_KEY = "offline-gate-not-a-secret";
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        // No request reaches the network. Transport/schema changes fail closed.
        assertVerifierEndpoint(request, "openai");
        const body = JSON.parse(await request.text());
        const kind = verifierRequestSchema(body);
        requests.push({ caseId: active.id, schema: kind, body });
        if (active.transport === "provider-error") {
          transportFailures++;
          return new Response(
            JSON.stringify({
              error: { message: "injected provider failure", type: "invalid_request_error" },
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        const text = JSON.stringify(body);
        const indices = [
          ...new Set([...text.matchAll(/evidence_idx=(\d+)/g)].map((m) => Number(m[1]))),
        ];
        const data =
          active.transport === "schema-error" && kind === "FusedJudgment"
            ? {}
            : kind === "BatchedRelevance"
              ? {
                  items: indices.map((evidence_idx) => ({
                    evidence_idx,
                    scores: activeRubric.items.map((_, criterion_idx) => ({
                      criterion_idx,
                      score: 10,
                    })),
                  })),
                }
              : {
                  outcome: {
                    primary_intent: "Check the frozen fixture",
                    reasoning: active.expectedOutcome
                      ? "Fixture observations support every required fact."
                      : "Fixture observations contradict required facts.",
                    output_success: active.expectedOutcome,
                    findings: [],
                  },
                  per_criterion: activeRubric.items.map((item, criterion_idx) => ({
                    criterion_idx,
                    applicable_evidence: active.observation,
                    justification: "Deterministic provider response fixture.",
                    earned_points: active.expectedOutcome ? item.maxPoints : 0,
                    evidence_sufficient: true,
                  })),
                  task_validity: { is_ambiguous: false, is_invalid: false },
                };
        if (active.transport === "schema-error" && kind === "FusedJudgment") transportFailures++;
        const response = request.url.endsWith("/responses")
          ? {
              id: "resp_fixture",
              object: "response",
              created_at: 0,
              status: "completed",
              model: "gpt-4.1-mini",
              output: [
                {
                  id: "msg_fixture",
                  type: "message",
                  role: "assistant",
                  status: "completed",
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify(data),
                      annotations: [] as unknown[],
                    },
                  ],
                },
              ],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            }
          : {
              id: "chatcmpl_fixture",
              object: "chat.completion",
              created: 0,
              model: "gpt-4.1-mini",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: JSON.stringify(data) },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
        return new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
        });
      };
    }
    const carrier = new sdk.V3({
      env: "LOCAL",
      disableAPI: true,
      disablePino: true,
      logger: () => {},
      verbose: 0,
    });
    const logger = { log: () => {}, warn: () => {} } as unknown as EvalLogger;
    try {
      for (const fixture of fixtures) {
        active = fixture;
        const row = rows.get(fixture.taskId);
        assert(
          row && row.rubric_version === "1.2",
          `fixture ${fixture.id} requires a real v1.2 row`,
        );
        const originalRubric = sdk.normalizeRubric(row.precomputed_rubric);
        assert(originalRubric?.items.length, "missing source rubric");
        activeRubric = fixture.criterionIndices
          ? { items: fixture.criterionIndices.map((i) => originalRubric.items[i]) }
          : originalRubric;
        assert(activeRubric.items.every(Boolean), "invalid criterion slice");
        const taskSpec = {
          id: `hardbench-compat/${fixture.id}`,
          instruction: fixture.instruction ?? row.ques,
          precomputedRubric: activeRubric,
          initUrl: "https://example.com/fixture",
        };
        const evaluator = adapter.createVerifierEvaluator(carrier);
        const resolved = await adapter.resolveRubricTraced(evaluator, {
          taskSpec,
          dataset: "hardbenchmark",
        });
        assert(
          resolved.source === "precomputed" &&
            JSON.stringify(resolved.rubric) === JSON.stringify(activeRubric),
          "precomputed rubric changed",
        );
        const trajectory: Trajectory = {
          task: taskSpec,
          status: "complete",
          usage: { input_tokens: 0, output_tokens: 0 },
          steps: [
            {
              actionName: "snapshot",
              actionArgs: {},
              reasoning: "Read the recorded page",
              agentEvidence: { modalities: [{ type: "text", content: fixture.observation }] },
              probeEvidence: { url: taskSpec.initUrl, ariaTree: fixture.observation },
              toolOutput: { ok: true, result: fixture.observation },
            },
          ],
          finalAnswer: fixture.answer,
          finalObservation: { url: taskSpec.initUrl, ariaTree: fixture.observation },
        };
        const requestStart = requests.length;
        const failureStart = transportFailures;
        const result = await adapter.gradeExternalTrajectory({
          buildTrajectory: () => trajectory,
          verifier: {
            v3: carrier,
            taskSpec,
            dataset: "hardbenchmark",
            successMode: "outcome",
            trajectoryRoot: path.join(options.out, "trajectories"),
            runId: fixture.id,
          },
          baseResult: { _success: fixture.baseSuccess },
          errorMessage: "Fixture outcome failed",
          category: "compatibility",
          logger,
        });
        let verdict: EvaluationResult | undefined;
        let error: string | undefined;
        try {
          assert(
            !result.verifierError,
            `verifierError: ${sanitizeGateError(result.verifierError)}`,
          );
          assert(typeof result.trajectoryDir === "string", "missing persisted trajectory");
          verdict = JSON.parse(
            await readFile(path.join(result.trajectoryDir, "scores/result.json"), "utf8"),
          );
          const persisted = JSON.parse(
            await readFile(path.join(result.trajectoryDir, "task_data.json"), "utf8"),
          );
          assert(
            JSON.stringify(persisted.task.precomputedRubric) === JSON.stringify(activeRubric),
            "persisted rubric changed",
          );
          assertVerifiedResult(result, verdict, activeRubric, fixture);
          if (!options.live) {
            const calls = requests.slice(requestStart);
            const fused = calls.filter((call) => call.schema === "FusedJudgment");
            assert(fused.length === 1, "expected one fused verification request");
            const prompt = JSON.stringify(fused[0].body);
            for (const [index, item] of activeRubric.items.entries()) {
              assert(
                prompt.includes(JSON.stringify(item.description).slice(1, -1)),
                "exact v1.2 criterion description absent from judge request",
              );
              const heading = `Criterion ${index} — "${item.criterion}" (max ${item.maxPoints} pts):`;
              assert(
                prompt.includes(JSON.stringify(heading).slice(1, -1)),
                "criterion identity/maxPoints absent from judge request",
              );
            }
            assert(transportFailures === failureStart, "provider transport failed");
            assert(
              verdict.processScore === (fixture.expectedOutcome ? 1 : 0),
              "recorded points were not scored",
            );
          }
        } catch (e) {
          error = sanitizeGateError(e, judgeApiKey ? [judgeApiKey] : []);
        }
        reports.push({
          id: fixture.id,
          taskId: fixture.taskId,
          scope: fixture.criterionIndices ? "criterion-slice" : "full-rubric",
          rubricHash: hash(JSON.stringify(activeRubric)),
          rubricSource: resolved.source,
          expectedOutcome: fixture.expectedOutcome,
          expectedProcess: fixture.expectedProcess,
          baseSuccess: fixture.baseSuccess,
          accepted: !error,
          error,
          injectedFault: fixture.transport,
          faultRejected: fixture.transport ? Boolean(error) : undefined,
          result: {
            ...result,
            ...(result.error !== undefined && {
              error: sanitizeGateError(result.error, judgeApiKey ? [judgeApiKey] : []),
            }),
            ...(result.verifierError !== undefined && {
              verifierError: sanitizeGateError(
                result.verifierError,
                judgeApiKey ? [judgeApiKey] : [],
              ),
            }),
          },
          verdict,
          requestCount: requests.length - requestStart,
        });
      }
    } finally {
      await carrier.close();
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
  }
  // Injected faults are expected test failures, never accepted verification cases.
  const passed = reports.every((r) => (r.injectedFault ? r.faultRejected : r.accepted));
  const summary = {
    schemaVersion: 2,
    requestEvidenceVersion: 1,
    passed,
    mode: options.live ? "live-bounded-semantic" : "offline-transport-only",
    repo,
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    node: process.version,
    sdkVersion: JSON.parse(await readFile(path.join(sdkPath, "package.json"), "utf8")).version,
    judgeModel: model,
    backend: "verifier",
    approach: "b",
    optionalSteps: "folded",
    datasetHash: hash(dataset),
    fixtureHash: hash(fixtureText),
    adapterHash: hash(await readFile(adapterPath, "utf8")),
    gateHash: hash(await readFile(fileURLToPath(import.meta.url), "utf8")),
    requestEvidenceHash: hash(
      await readFile(new URL("./hardbenchmark-request-evidence.ts", import.meta.url), "utf8"),
    ),
    evaluatorHash: hash(await readFile(path.join(sdkPath, "dist/esm/lib/v3Evaluator.js"), "utf8")),
    rubricVerifierHash: hash(
      await readFile(path.join(sdkPath, "dist/esm/lib/v3/verifier/rubricVerifier.js"), "utf8"),
    ),
    cases: reports,
  };
  await writeFile(path.join(options.out, "gate.json"), JSON.stringify(summary, null, 2) + "\n");
  await writeFile(
    path.join(options.out, "requests.json"),
    JSON.stringify(requests, null, 2) + "\n",
  );
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      dataset: { type: "string" },
      fixtures: { type: "string" },
      out: { type: "string" },
      live: { type: "boolean" },
      "judge-model": { type: "string" },
    },
  });
  if (!values.repo || !values.dataset || !values.fixtures || !values.out)
    throw new HardBenchmarkGateError(
      "Required: --repo --dataset --fixtures --out [--live --judge-model provider/model]",
    );
  try {
    const report = await runCompatibilityGate({
      repo: values.repo,
      dataset: values.dataset,
      fixtures: values.fixtures,
      out: values.out,
      live: values.live,
      judgeModel: values["judge-model"],
    });
    console.log(
      JSON.stringify({
        passed: report.passed,
        mode: report.mode,
        cases: report.cases.length,
        report: path.join(values.out, "gate.json"),
      }),
    );
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(sanitizeGateError(error));
    process.exitCode = 1;
  }
}
