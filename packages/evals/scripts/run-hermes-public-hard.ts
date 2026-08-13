import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { V3, type AvailableModel, type TaskSpec } from "stagehand-v3";

import { EvalLogger } from "../logger.js";
import { getPackageRootDir } from "../runtimePaths.js";
import {
  runHermesAgent,
  validateHermesBenchmarkRoot,
  type HermesBrowserSurface,
} from "../framework/hermesRunner.js";
import {
  hermesPilotVerifierSucceeded,
  resolveEffectiveHermesPilotRecord,
  summarizeHermesPilotRecords,
  type HermesPilotRecordContext,
} from "../framework/hermesPilotReporting.js";

type Arm = "A" | "B" | "D";
type Phase = "canary" | "full";

interface DatasetRow {
  task_id: string;
  confirmed_task: string;
  website: string;
}

interface PlanRow {
  task_id: string;
  model: string;
  arm_order: Arm[];
}

interface PilotManifest {
  id: string;
  dataset: string;
  dataset_file: string;
  dataset_file_sha256: string;
  task_ids: string[];
  verifier_model: string;
  success_mode: "both";
  timeout_seconds: number;
  run_plan: PlanRow[];
  canary_plan: PlanRow;
}

interface RunRow extends PlanRow {
  block: number;
  arm: Arm;
  run: number;
}

const SURFACES: Record<Arm, HermesBrowserSurface> = {
  A: "hermes_browser_legacy",
  B: "hermes_browser_exec",
  D: "hermes_stagehand_batch",
};

function requiredArg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Missing required argument ${name}`);
  return value;
}

function optionalArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function positiveIntArg(name: string, fallback: number): number {
  const value = optionalArg(name);
  if (!value) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error(`${name} must be positive`);
  return Number(value);
}

function sha256(value: Uint8Array | string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+|[._]+$/g, "") || "run";
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(temporary, file);
}

function readManifest(): { manifest: PilotManifest; bytes: Buffer; packageRoot: string } {
  const packageRoot = getPackageRootDir();
  const manifestPath = path.join(packageRoot, "pilots", "hermes-online-mind2web-hard-v1.json");
  const bytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(bytes.toString("utf8")) as PilotManifest;
  if (
    manifest.run_plan.length !== 10 ||
    manifest.task_ids.length !== 10 ||
    manifest.run_plan.flatMap((row) => row.arm_order).length !== 30
  ) {
    throw new Error("Frozen Hermes public-hard manifest has an invalid schedule");
  }
  return { manifest, bytes, packageRoot };
}

function readDataset(packageRoot: string, manifest: PilotManifest): Map<string, DatasetRow> {
  const datasetPath = path.join(packageRoot, manifest.dataset_file);
  const bytes = fs.readFileSync(datasetPath);
  const observed = sha256(bytes);
  if (observed !== manifest.dataset_file_sha256) {
    throw new Error(
      `Online-Mind2Web source drifted: expected ${manifest.dataset_file_sha256}, observed ${observed}`,
    );
  }
  const rows = bytes
    .toString("utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DatasetRow);
  const selected = new Map(rows.map((row) => [row.task_id, row]));
  for (const taskId of manifest.task_ids) {
    if (!selected.has(taskId)) throw new Error(`Frozen task is absent from the source: ${taskId}`);
  }
  return selected;
}

function schedule(manifest: PilotManifest, phase: Phase): RunRow[] {
  const blocks = phase === "canary" ? [manifest.canary_plan] : manifest.run_plan;
  let run = 0;
  return blocks.flatMap((block, index) =>
    block.arm_order.map((arm) => ({ ...block, block: index + 1, arm, run: ++run })),
  );
}

function runDirectory(outputRoot: string, row: RunRow, phase: Phase): string {
  return path.join(
    outputRoot,
    `${phase}-block-${String(row.block).padStart(2, "0")}-${safe(row.model)}-${row.task_id}`,
    row.arm,
  );
}

function readRecord(file: string): Record<string, unknown> {
  const value = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  if (!value || typeof value !== "object") throw new Error(`Malformed record: ${file}`);
  return value as Record<string, unknown>;
}

function validateRecordIdentity(
  record: Record<string, unknown>,
  row: RunRow,
  phase: Phase,
  manifestSha256: string,
): void {
  const expected = {
    suite_id: "hermes-online-mind2web-hard-v1",
    manifest_sha256: manifestSha256,
    phase,
    task_id: row.task_id,
    model_id: row.model,
    arm: row.arm,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (record[key] !== value) throw new Error(`Resumed record identity mismatch at ${key}`);
  }
}

function canaryGate(root: string, manifest: PilotManifest, manifestSha256: string): void {
  for (const row of schedule(manifest, "canary")) {
    const recordPath = path.join(runDirectory(root, row, "canary"), "record.json");
    if (!fs.existsSync(recordPath)) throw new Error(`Canary record is missing for arm ${row.arm}`);
    const record = readRecord(recordPath);
    validateRecordIdentity(record, row, "canary", manifestSha256);
    const effective = resolveEffectiveHermesPilotRecord(
      reportingContext(record, path.dirname(recordPath), row, manifest),
    ).record;
    if (effective.verifier_graded !== true || effective.status === "error") {
      throw new Error(`Canary did not produce a valid graded trajectory for arm ${row.arm}`);
    }
  }
}

function reportingContext(
  record: Record<string, unknown>,
  runDir: string,
  row: RunRow,
  manifest: PilotManifest,
): HermesPilotRecordContext {
  return {
    record,
    runDir,
    identity: {
      taskId: row.task_id,
      surface: SURFACES[row.arm],
      verifierModel: manifest.verifier_model,
    },
    successMode: manifest.success_mode,
  };
}

async function verifyGatewayModels(manifest: PilotManifest): Promise<void> {
  let response: Response;
  try {
    response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    throw new Error(
      `Vercel AI Gateway catalog verification failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
  if (!response.ok) throw new Error(`Vercel AI Gateway catalog returned HTTP ${response.status}`);
  const payload = asRecord((await response.json()) as unknown);
  const items = Array.isArray(payload?.data) ? payload.data : [];
  const byId = new Map(
    items
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => [String(item.id), item]),
  );
  for (const model of new Set(manifest.run_plan.map((row) => row.model))) {
    const item = byId.get(model);
    const tags = item?.tags;
    const pricing = asRecord(item?.pricing);
    if (
      item?.type !== "language" ||
      !Array.isArray(tags) ||
      !tags.includes("tool-use") ||
      number(pricing?.input) <= 0 ||
      number(pricing?.output) <= 0
    ) {
      throw new Error(`Vercel AI Gateway model contract is unavailable or invalid: ${model}`);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

async function executeRow(input: {
  row: RunRow;
  phase: Phase;
  runDir: string;
  task: DatasetRow;
  manifest: PilotManifest;
  manifestSha256: string;
}): Promise<Record<string, unknown>> {
  const { row, phase, runDir, task, manifest, manifestSha256 } = input;
  const artifactRoot = path.join(runDir, "artifacts");
  process.env.EVAL_HERMES_ARTIFACT_ROOT = artifactRoot;
  process.env.EVAL_VERIFIER_MODEL = manifest.verifier_model;
  process.env.EVAL_SUCCESS_MODE = manifest.success_mode;
  process.env.EVAL_MAX_UNVERIFIABLE_CRITERIA = "0";
  process.env.EVAL_HERMES_TIMEOUT_MS = String(manifest.timeout_seconds * 1_000);

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
  const taskSpec: TaskSpec = {
    id: task.task_id,
    instruction: task.confirmed_task,
    initUrl: task.website,
  };
  const startedAt = Date.now();
  try {
    const result = await runHermesAgent({
      plan: {
        dataset: "onlineMind2Web",
        taskId: task.task_id,
        startUrl: task.website,
        instruction: task.confirmed_task,
      },
      taskSpec,
      model: row.model as AvailableModel,
      surface: SURFACES[row.arm],
      environment: "BROWSERBASE",
      logger,
      verifier: {
        v3: carrier,
        taskSpec,
        dataset: "onlineMind2Web",
        successMode: "both",
        trajectoryRoot: path.join(runDir, "stagehand-verifier"),
        runId: `${phase}-${String(row.block).padStart(2, "0")}-${row.arm}`,
      },
    });
    const metrics = asRecord(result.rawMetrics);
    const outer = asRecord(metrics?.outer);
    const combined = asRecord(metrics?.combined);
    const outcomeSuccess = result.outcomeSuccess;
    const processScore = result.processScore;
    const evidenceInsufficientCount = Array.isArray(result.evidenceInsufficient)
      ? result.evidenceInsufficient.length
      : undefined;
    const verifierGraded =
      !result.verifierError &&
      typeof result.criterionCount === "number" &&
      result.criterionCount > 0 &&
      typeof outcomeSuccess === "boolean" &&
      typeof processScore === "number" &&
      typeof evidenceInsufficientCount === "number";
    const benchmarkSuccess =
      verifierGraded &&
      typeof outcomeSuccess === "boolean" &&
      typeof processScore === "number" &&
      typeof evidenceInsufficientCount === "number" &&
      hermesPilotVerifierSucceeded(
        {
          outcome: outcomeSuccess,
          process_score: processScore,
          evidence_insufficient_count: evidenceInsufficientCount,
        },
        "both",
      );
    const record: Record<string, unknown> = {
      schema_version: 1,
      suite_id: "hermes-online-mind2web-hard-v1",
      manifest_sha256: manifestSha256,
      phase,
      block: row.block,
      run: row.run,
      task_id: row.task_id,
      model_id: row.model,
      arm: row.arm,
      arm_order: row.arm_order,
      surface: SURFACES[row.arm],
      status: verifierGraded ? (benchmarkSuccess ? "verified_passed" : "verified_failed") : "error",
      accuracy: verifierGraded ? benchmarkSuccess : null,
      verifier_graded: verifierGraded,
      outcome: result.outcomeSuccess ?? null,
      process_score: result.processScore ?? null,
      criterion_count: result.criterionCount ?? null,
      evidence_insufficient_count: evidenceInsufficientCount ?? null,
      verifier_error: result.verifierError ?? null,
      trajectory_dir: result.trajectoryDir ?? null,
      artifact_dir: result.hermesArtifactDir ?? null,
      final_answer: result.finalAnswer ?? null,
      final_answer_sha256:
        typeof result.finalAnswer === "string" ? sha256(result.finalAnswer) : null,
      tool_calls: number(result.toolCallCount),
      usage: {
        input_tokens: number(combined?.input_tokens),
        output_tokens: number(combined?.output_tokens),
        cache_read_tokens: number(combined?.cache_read_tokens),
        cache_write_tokens: number(combined?.cache_write_tokens),
        reasoning_tokens: number(combined?.reasoning_tokens),
        api_calls: number(combined?.api_calls),
      },
      cost_usd: number(outer?.estimated_cost_usd),
      timing: {
        total_wall_ms: Date.now() - startedAt,
        agent_wall_ms: number(metrics?.agent_wall_ms),
        browser_wall_ms: number(metrics?.browser_wall_ms),
        session_setup_ms: number(metrics?.session_setup_ms),
        verifier_wall_ms: number(metrics?.verifier_wall_ms),
      },
      created_at: new Date().toISOString(),
    };
    await writeJsonAtomic(path.join(runDir, "record.json"), record);
    return record;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const record: Record<string, unknown> = {
      schema_version: 1,
      suite_id: "hermes-online-mind2web-hard-v1",
      manifest_sha256: manifestSha256,
      phase,
      block: row.block,
      run: row.run,
      task_id: row.task_id,
      model_id: row.model,
      arm: row.arm,
      arm_order: row.arm_order,
      surface: SURFACES[row.arm],
      status: "error",
      accuracy: null,
      verifier_graded: false,
      error: message,
      created_at: new Date().toISOString(),
    };
    await writeJsonAtomic(path.join(runDir, "record.json"), record);
    return record;
  } finally {
    await carrier.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  const phase = requiredArg("--phase") as Phase;
  if (phase !== "canary" && phase !== "full") throw new Error("--phase must be canary or full");
  const dryRun = process.argv.includes("--dry-run");
  const confirmBillable = process.argv.includes("--confirm-billable");
  if (dryRun === confirmBillable) {
    throw new Error("Choose exactly one of --dry-run or --confirm-billable");
  }
  const outputRoot = path.resolve(optionalArg("--output") ?? "/tmp/stagehand-evals-public-hard");
  const firstBlock = positiveIntArg("--first-block", 1);
  const lastBlock = positiveIntArg("--last-block", 10);
  const canaryRootArg = optionalArg("--canary-root");
  const { manifest, bytes: manifestBytes, packageRoot } = readManifest();
  const manifestSha256 = sha256(manifestBytes);
  const dataset = readDataset(packageRoot, manifest);
  const hermesRoot = path.resolve(
    process.env.EVAL_HERMES_ROOT?.trim() ||
      path.join(packageRoot, "..", "..", "..", "hermes-stagehand-batch"),
  );
  validateHermesBenchmarkRoot(hermesRoot);
  const rows = schedule(manifest, phase).filter(
    (row) => phase === "canary" || (row.block >= firstBlock && row.block <= lastBlock),
  );
  if (rows.length === 0) throw new Error("Selected block range is empty");

  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          dry_run: true,
          phase,
          suite_id: manifest.id,
          manifest_sha256: manifestSha256,
          dataset_sha256: manifest.dataset_file_sha256,
          rows,
          model_calls: 0,
          browser_sessions: 0,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (!process.env.EVAL_RUBRIC_CACHE_ROOT?.trim()) {
    throw new Error("EVAL_RUBRIC_CACHE_ROOT must identify one durable shared cache");
  }
  if (!process.env.AI_GATEWAY_API_KEY?.trim()) {
    throw new Error("AI_GATEWAY_API_KEY is required for billable runs");
  }
  if (!process.env.BROWSERBASE_API_KEY?.trim()) {
    throw new Error("BROWSERBASE_API_KEY is required for billable runs");
  }
  await verifyGatewayModels(manifest);
  if (phase === "full") {
    if (!canaryRootArg) throw new Error("Full phase requires --canary-root");
    canaryGate(path.resolve(canaryRootArg), manifest, manifestSha256);
  }
  await fsp.mkdir(outputRoot, { recursive: true });
  const outputManifest = path.join(outputRoot, "manifest.json");
  if (fs.existsSync(outputManifest)) {
    if (sha256(fs.readFileSync(outputManifest)) !== manifestSha256) {
      throw new Error("Output root belongs to a different manifest");
    }
  } else {
    await fsp.writeFile(outputManifest, manifestBytes);
  }

  const records: Array<Record<string, unknown>> = [];
  const completedRows: RunRow[] = [];
  for (const row of rows) {
    const runDir = runDirectory(outputRoot, row, phase);
    const recordPath = path.join(runDir, "record.json");
    if (fs.existsSync(recordPath)) {
      const record = readRecord(recordPath);
      validateRecordIdentity(record, row, phase, manifestSha256);
      records.push(record);
      completedRows.push(row);
      continue;
    }
    if (fs.existsSync(runDir) && fs.readdirSync(runDir).length > 0) {
      throw new Error(`Partial run directory requires audit before resume: ${runDir}`);
    }
    await fsp.mkdir(runDir, { recursive: true });
    const task = dataset.get(row.task_id);
    if (!task) throw new Error(`Task disappeared from dataset: ${row.task_id}`);
    records.push(await executeRow({ row, phase, runDir, task, manifest, manifestSha256 }));
    completedRows.push(row);
    await writeJsonAtomic(
      path.join(outputRoot, "summary.json"),
      summarize(records, completedRows, outputRoot, phase, manifest),
    );
  }
  if (phase === "canary") canaryGate(outputRoot, manifest, manifestSha256);
  const summary = summarize(records, completedRows, outputRoot, phase, manifest);
  await writeJsonAtomic(path.join(outputRoot, "summary.json"), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function summarize(
  records: Array<Record<string, unknown>>,
  rows: RunRow[],
  outputRoot: string,
  phase: Phase,
  manifest: PilotManifest,
): Record<string, unknown> {
  const contexts = records.map((record, index) => {
    const row = rows[index];
    if (!row) throw new Error("Benchmark summary row alignment failed");
    return reportingContext(record, runDirectory(outputRoot, row, phase), row, manifest);
  });
  return summarizeHermesPilotRecords(contexts, phase);
}

main().catch((error) => {
  process.stderr.write(
    `Stagehand evals public-hard benchmark failed closed: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exitCode = 4;
});
