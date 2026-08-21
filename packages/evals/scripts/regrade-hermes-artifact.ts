import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { V3, type TaskSpec } from "stagehand-v3";

import { EvalLogger } from "../logger.js";
import { getPackageRootDir } from "../runtimePaths.js";
import {
  gradeHermesArtifact,
  HERMES_BROWSER_SURFACES,
  loadHermesArtifactDirectory,
  type HermesBrowserSurface,
} from "../framework/hermesRunner.js";

interface OnlineMind2WebRow {
  task_id: string;
  confirmed_task: string;
  website: string;
}

interface PilotManifest {
  task_ids: string[];
  verifier_model: string;
}

interface BenchmarkManifest {
  schema_version: "1";
  suite: { id: string };
  grading: { primary_verifier: { model: string } };
  tasks: OnlineMind2WebRow[];
}

function readRequiredArg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing required argument ${name}`);
  }
  return value;
}

function readOptionalArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function taskSpec(row: OnlineMind2WebRow): TaskSpec {
  return {
    id: row.task_id,
    instruction: row.confirmed_task,
    initUrl: row.website,
  };
}

function readTask(taskId: string): TaskSpec {
  const datasetPath = path.join(
    getPackageRootDir(),
    "datasets",
    "onlineMind2Web",
    "onlineMind2Web.jsonl",
  );
  const row = fs
    .readFileSync(datasetPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OnlineMind2WebRow)
    .find((candidate) => candidate.task_id === taskId);
  if (!row) throw new Error(`OnlineMind2Web task not found: ${taskId}`);
  return taskSpec(row);
}

function readBenchmarkTask(
  file: string,
  expectedSha256: string,
  taskId: string,
): { task: TaskSpec; verifierModel: string } {
  const bytes = fs.readFileSync(file);
  const observed = crypto.createHash("sha256").update(bytes).digest("hex");
  if (observed !== expectedSha256) {
    throw new Error(
      `Benchmark manifest digest mismatch: expected ${expectedSha256}, observed ${observed}`,
    );
  }
  const manifest = JSON.parse(bytes.toString("utf8")) as BenchmarkManifest;
  if (
    manifest.schema_version !== "1" ||
    typeof manifest.suite?.id !== "string" ||
    !Array.isArray(manifest.tasks) ||
    typeof manifest.grading?.primary_verifier?.model !== "string"
  ) {
    throw new Error("Benchmark manifest is malformed");
  }
  const row = manifest.tasks.find((candidate) => candidate.task_id === taskId);
  if (!row) throw new Error(`Task ${taskId} is not part of the retained benchmark manifest.`);
  return { task: taskSpec(row), verifierModel: manifest.grading.primary_verifier.model };
}

async function main(): Promise<void> {
  const artifactDir = path.resolve(readRequiredArg("--artifact"));
  const taskId = readRequiredArg("--task-id");
  const trajectoryRoot = path.resolve(readRequiredArg("--trajectory-root"));
  const resultJsonArg = readOptionalArg("--result-json");
  const resultJson = resultJsonArg ? path.resolve(resultJsonArg) : undefined;
  const benchmarkManifestArg = readOptionalArg("--benchmark-manifest");
  const benchmarkManifestSha256 = readOptionalArg("--benchmark-manifest-sha256");
  if (Boolean(benchmarkManifestArg) !== Boolean(benchmarkManifestSha256)) {
    throw new Error(
      "--benchmark-manifest and --benchmark-manifest-sha256 must be supplied together",
    );
  }
  let task: TaskSpec;
  let declaredVerifierModel: string;
  if (benchmarkManifestArg && benchmarkManifestSha256) {
    const retained = readBenchmarkTask(
      path.resolve(benchmarkManifestArg),
      benchmarkManifestSha256,
      taskId,
    );
    task = retained.task;
    declaredVerifierModel = retained.verifierModel;
  } else {
    const packageRoot = getPackageRootDir();
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, "pilots", "hermes-online-mind2web-hard-v1.json"),
        "utf8",
      ),
    ) as PilotManifest;
    if (!manifest.task_ids.includes(taskId)) {
      throw new Error(`Task ${taskId} is not part of the frozen Hermes pilot.`);
    }
    task = readTask(taskId);
    declaredVerifierModel = manifest.verifier_model;
  }

  const surfaceValue = readOptionalArg("--surface") ?? "hermes_stagehand_batch";
  if (!HERMES_BROWSER_SURFACES.includes(surfaceValue as HermesBrowserSurface)) {
    throw new Error(`Unsupported Hermes surface: ${surfaceValue}`);
  }
  const surface = surfaceValue as HermesBrowserSurface;
  const verifierModel = readOptionalArg("--verifier-model") ?? declaredVerifierModel;
  if (verifierModel !== declaredVerifierModel) {
    throw new Error(
      `Verifier model ${verifierModel} differs from retained declaration ${declaredVerifierModel}`,
    );
  }
  process.env.EVAL_VERIFIER_MODEL = verifierModel;
  process.env.VERIFIER_PERSIST_TRAJECTORIES = "1";

  const taskSpec = task;
  const artifact = await loadHermesArtifactDirectory(artifactDir, surface);
  const logger = new EvalLogger(true);
  const carrier = new V3({
    env: "LOCAL",
    logger: logger.log.bind(logger),
    disablePino: true,
    disableAPI: true,
    experimental: true,
    verbose: 0,
  });
  logger.init(carrier);

  try {
    const result = await gradeHermesArtifact({
      artifact,
      taskSpec,
      logger,
      verifier: {
        v3: carrier,
        taskSpec,
        dataset: "onlineMind2Web",
        trajectoryRoot,
        runId: `regrade-${path.basename(artifactDir)}`,
      },
    });
    const rawMetrics = result.rawMetrics as
      | { outer?: { total_tokens?: number }; combined?: Record<string, number> }
      | undefined;
    const summary = {
      artifactDir,
      taskId,
      surface,
      verifierModel,
      agentCompleted:
        artifact.exitCode === 0 &&
        artifact.usage.completed === true &&
        artifact.usage.failed !== true,
      agentApiCalls: artifact.usage.api_calls,
      agentTotalTokens:
        artifact.usage.input_tokens +
        artifact.usage.output_tokens +
        artifact.usage.cache_read_tokens +
        artifact.usage.cache_write_tokens,
      toolCallCount: artifact.toolCallCount,
      evidenceStepCount: artifact.stepObservations?.filter(Boolean).length ?? 0,
      verifierGraded: !result.verifierError,
      benchmarkSuccess: result._success,
      outcomeSuccess: result.outcomeSuccess,
      processScore: result.processScore,
      criterionCount: result.criterionCount,
      evidenceInsufficientCount: Array.isArray(result.evidenceInsufficient)
        ? result.evidenceInsufficient.length
        : undefined,
      trajectoryDir: result.trajectoryDir,
      verifierError: result.verifierError,
      combinedUsage: rawMetrics?.combined,
    };
    console.log(JSON.stringify(summary, null, 2));

    if (result.verifierError) {
      process.exitCode = 1;
      return;
    }
    if (typeof result.outcomeSuccess !== "boolean" || typeof result.processScore !== "number") {
      throw new Error("Verifier returned neither a boolean outcome nor a numeric process score.");
    }
    if (resultJson) {
      const verifierResult = {
        schema_version: 1,
        task_id: taskId,
        surface,
        verifier_model: verifierModel,
        outcome: result.outcomeSuccess,
        process_score: result.processScore,
        criterion_count: result.criterionCount,
        evidence_insufficient_count: summary.evidenceInsufficientCount,
        trajectory_dir: result.trajectoryDir,
      };
      fs.mkdirSync(path.dirname(resultJson), { recursive: true });
      const temporary = `${resultJson}.tmp-${process.pid}`;
      fs.writeFileSync(temporary, `${JSON.stringify(verifierResult, null, 2)}\n`, "utf8");
      fs.renameSync(temporary, resultJson);
    }
  } finally {
    // Best-effort cleanup only. Some provider clients retain an idle handle
    // while closing; the durable JSON/trajectory writes above are the hook's
    // commit point and the explicit process exit below bounds this CLI.
    void carrier.close().catch(() => {});
  }
}

main().then(
  () => {
    // V3Evaluator's HTTP clients can retain idle connection handles after the
    // result and trajectory have been durably written. This script is also the
    // native benchmark's bounded post-run hook, so leaving those handles alive
    // would turn a successful grade into a 15-minute hook timeout.
    process.exit(process.exitCode ?? 0);
  },
  (error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  },
);
