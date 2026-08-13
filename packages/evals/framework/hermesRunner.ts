import { execFile, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AvailableModel, ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { getRepoRootDir } from "../runtimePaths.js";
import { buildTrajectory, type NormalizedToolCall } from "./harnesses/trajectoryAdapter.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { datasetPromptGuidance } from "./externalHarnessPlan.js";
import { gradeExternalTrajectory, type ExternalHarnessVerifierConfig } from "./verifierAdapter.js";
import type { TaskResult } from "./types.js";

export const HERMES_BROWSER_SURFACES = [
  "hermes_browser_legacy",
  "hermes_browser_exec",
  "hermes_stagehand_batch",
] as const;
export type HermesBrowserSurface = (typeof HERMES_BROWSER_SURFACES)[number];

export interface HermesUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  api_calls: number;
  estimated_cost_usd?: number;
  session_id?: string;
  completed?: boolean;
  failed?: boolean;
}

export interface HermesToolSchema {
  bytes: number;
  names: string[];
}

export interface HermesMessageRow {
  id: number;
  role: string;
  content: string | null;
  tool_call_id: string | null;
  tool_calls: string | null;
  tool_name: string | null;
  reasoning: string | null;
  reasoning_content: string | null;
}

export interface HermesRunArtifact {
  surface: HermesBrowserSurface;
  stdout: string;
  stderr: string;
  exitCode: number;
  messages: HermesMessageRow[];
  usage: HermesUsage;
  innerUsage?: HermesUsage;
  toolCallCount: number;
  finalObservation?: ProbeEvidence;
  /** Successful browser-call evidence indexed by one-based Hermes action order. */
  stepObservations?: Array<ProbeEvidence | undefined>;
  toolSchema?: HermesToolSchema;
  toolMetrics?: Array<Record<string, unknown>>;
  agentWallMs?: number;
  browserWallMs?: number;
  sessionSetupMs?: number;
  artifactDir?: string;
}

export interface HermesRunnerInput {
  plan: ExternalHarnessTaskPlan;
  taskSpec: TaskSpec;
  model: AvailableModel;
  surface: HermesBrowserSurface;
  environment: "LOCAL" | "BROWSERBASE";
  logger: EvalLogger;
  signal?: AbortSignal;
  verifier: ExternalHarnessVerifierConfig;
}

export interface HermesArtifactGradeInput {
  artifact: HermesRunArtifact;
  taskSpec: TaskSpec;
  logger: EvalLogger;
  verifier: ExternalHarnessVerifierConfig;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const HERMES_PROVIDER = "ai-gateway";
export const PINNED_HERMES_BASE_COMMIT = "e65664f512ded961ec7b2fdbeb4a88008f439866";
export const PINNED_STAGEHAND_V4_COMMIT = "4186c7d98d2f325b6fc85b3f760111e6c390d703";
export const DEFAULT_STAGEHAND_V4_ROOT = "/workspace/stagehand-v4-tip-4186";
const TOOL_SCHEMA_PREFIX = "__STAGEHAND_EVALS_HERMES_TOOL_SCHEMA__";
const EXPECTED_TOOL_SCHEMAS: Record<HermesBrowserSurface, HermesToolSchema> = {
  hermes_browser_legacy: {
    bytes: 11_322,
    names: [
      "browser_back",
      "browser_cdp",
      "browser_click",
      "browser_console",
      "browser_dialog",
      "browser_get_images",
      "browser_navigate",
      "browser_press",
      "browser_scroll",
      "browser_snapshot",
      "browser_type",
      "browser_vision",
    ],
  },
  hermes_browser_exec: { bytes: 10_387, names: ["browser_exec"] },
  hermes_stagehand_batch: { bytes: 10_461, names: ["browser_exec"] },
};
const PINNED_BROWSER_USE = {
  packageVersion: "0.13.7",
  harnessVersion: "0.1.8",
  freezeSha256: "1fbd36e2939e5790583941b62137e543f743973f3e32c8bbdf700d638dcfbd4d",
  skillBytes: 7_745,
  skillSha256: "0f3ca9aab1dec2c66ae849004a02f2b4ff24a97e6c1be6ebefed8ce4dc26f4d4",
  nodeVersion: "agent-browser 0.26.0",
  nodeLockSha256: "d45eea8072bbfdc078158d0029c7cad29ebd81421f8193aa854795704e65f1b8",
} as const;
const validatedHermesRoots = new Set<string>();

export function resolveHermesToolSurface(requested?: ToolSurface): HermesBrowserSurface {
  if (!requested) return "hermes_browser_exec";
  if (
    requested === "hermes_browser_legacy" ||
    requested === "hermes_browser_exec" ||
    requested === "hermes_stagehand_batch"
  ) {
    return requested;
  }
  throw new EvalsError(
    `Hermes harness supports --tool hermes_browser_legacy, --tool hermes_browser_exec, or --tool hermes_stagehand_batch; received "${requested}".`,
  );
}

export function resolveHermesStartupProfile(
  toolSurface: ToolSurface,
  environment: "LOCAL" | "BROWSERBASE",
  requested?: StartupProfile,
): StartupProfile {
  resolveHermesToolSurface(toolSurface);
  if (toolSurface === "hermes_stagehand_batch" && environment !== "BROWSERBASE") {
    throw new EvalsError(
      "Hermes Stagehand batch launches through Browserbase and requires --env browserbase.",
    );
  }
  const expected = environment === "BROWSERBASE" ? "tool_create_browserbase" : "tool_launch_local";
  if (requested && requested !== expected) {
    throw new EvalsError(
      `Hermes owns its browser lifecycle; ${environment} requires startup profile "${expected}", not "${requested}".`,
    );
  }
  return expected;
}

export function applyHermesSurfaceEnvironment(
  env: NodeJS.ProcessEnv,
  surface: HermesBrowserSurface,
  hermesRoot: string,
): void {
  if (surface === "hermes_browser_legacy") {
    env.HERMES_BENCHMARK_STATIC_BROWSER = "1";
    env.PATH = [
      path.join(hermesRoot, ".browser-use-node", "node_modules", ".bin"),
      path.join(hermesRoot, ".browser-use-venv", "bin"),
      env.PATH ?? "",
    ].join(path.delimiter);
    return;
  }

  env.HERMES_BENCHMARK_BROWSER_EXEC_ONLY = "1";
  if (surface === "hermes_browser_exec") {
    // The public A/B/D contract compares the same full Browser Use skill arm
    // as the Hermes-native executor, not the smaller pinned-digest C arm.
    env.HERMES_BENCHMARK_BROWSER_USE_DESCRIPTION = "full";
    env.PATH = [
      path.join(hermesRoot, ".browser-use-node", "node_modules", ".bin"),
      path.join(hermesRoot, ".browser-use-venv", "bin"),
      env.PATH ?? "",
    ].join(path.delimiter);
  }
}

export function buildHermesPrompt(plan: ExternalHarnessTaskPlan): string {
  return [
    "You are running a browser benchmark task.",
    "",
    `Dataset: ${plan.dataset}`,
    plan.taskId ? `Task ID: ${plan.taskId}` : undefined,
    `Start URL: ${plan.startUrl}`,
    "",
    "Instruction:",
    plan.instruction,
    "",
    datasetPromptGuidance(plan.dataset),
    "Use only the browser tools provided by this Hermes run. Navigate to the Start URL before working on the task.",
    "Complete the task and put the requested result in your final response.",
  ]
    .filter((value): value is string => value !== undefined)
    .join("\n");
}

export function hermesArtifactToTrajectory(
  artifact: HermesRunArtifact,
  taskSpec: TaskSpec,
): Trajectory {
  const toolResults = new Map<string, HermesMessageRow>();
  const unkeyedToolResults: HermesMessageRow[] = [];
  for (const row of artifact.messages) {
    if (row.role !== "tool") continue;
    if (row.tool_call_id) toolResults.set(row.tool_call_id, row);
    else unkeyedToolResults.push(row);
  }

  const calls: NormalizedToolCall[] = [];
  let callIndex = 0;
  let unkeyedResultIndex = 0;
  for (const row of artifact.messages) {
    if (row.role !== "assistant" || !row.tool_calls) continue;
    const parsedCalls = parseToolCalls(row.tool_calls);
    let reasoning = firstNonempty(row.reasoning_content, row.reasoning, row.content) ?? undefined;
    for (const rawCall of parsedCalls) {
      const callId = readString(rawCall, "call_id") ?? readString(rawCall, "id");
      const fn = asRecord(rawCall.function);
      const name = fn ? readString(fn, "name") : undefined;
      if (!name) continue;
      const resultRow =
        (callId ? toolResults.get(callId) : undefined) ?? unkeyedToolResults[unkeyedResultIndex++];
      const result = parseHermesToolResult(resultRow?.content ?? "");
      const args = parseToolArguments(fn?.arguments);
      calls.push({
        name,
        args,
        result: result.value,
        ok: result.ok,
        ...(!result.ok && { error: result.error ?? "Hermes tool call failed" }),
        ...(reasoning && { reasoning }),
        ...(artifact.stepObservations?.[callIndex] && {
          probeEvidence: artifact.stepObservations[callIndex],
        }),
      });
      callIndex += 1;
      reasoning = undefined;
    }
  }

  const finalAnswer = [...artifact.messages]
    .reverse()
    .find((row) => row.role === "assistant" && !row.tool_calls && row.content?.trim())
    ?.content?.trim();

  const combinedUsage = addUsage(artifact.usage, artifact.innerUsage ?? emptyUsage(false));
  return buildTrajectory({
    taskSpec,
    toolCalls: calls,
    finalAnswer: finalAnswer || artifact.stdout.trim() || undefined,
    status: artifact.exitCode === 0 && artifact.usage.failed !== true ? "complete" : "error",
    usage: {
      input_tokens: combinedUsage.input_tokens,
      output_tokens: combinedUsage.output_tokens,
      cached_input_tokens: combinedUsage.cache_read_tokens,
      reasoning_tokens: combinedUsage.reasoning_tokens,
    },
    ...(artifact.finalObservation?.screenshot && {
      finalObservation: artifact.finalObservation,
    }),
  });
}

/** Refuse to send an incomplete or methodology-drifting run to the judge. */
export function validateHermesArtifact(artifact: HermesRunArtifact): void {
  const failures: string[] = [];
  if (
    artifact.exitCode !== 0 ||
    artifact.usage.completed !== true ||
    artifact.usage.failed === true
  ) {
    failures.push("Hermes usage does not mark the run complete");
  }
  if (!artifact.usage.session_id) failures.push("Hermes usage has no session_id");
  if (artifact.messages.length === 0) failures.push("Hermes session has no messages");
  const finalAnswer = [...artifact.messages]
    .reverse()
    .find((row) => row.role === "assistant" && !row.tool_calls && row.content?.trim())
    ?.content?.trim();
  if (!finalAnswer) failures.push("Hermes session has no final response");

  const resultIds = new Set(
    artifact.messages
      .filter((row) => row.role === "tool" && row.tool_call_id)
      .map((row) => row.tool_call_id as string),
  );
  let parsedCalls = 0;
  const parsedNames: string[] = [];
  for (const row of artifact.messages) {
    if (row.role !== "assistant" || !row.tool_calls) continue;
    let value: unknown;
    try {
      value = JSON.parse(row.tool_calls);
    } catch {
      failures.push(`assistant message ${row.id} has malformed tool_calls JSON`);
      continue;
    }
    if (!Array.isArray(value)) {
      failures.push(`assistant message ${row.id} tool_calls is not an array`);
      continue;
    }
    for (const rawCall of value) {
      if (!isRecord(rawCall)) {
        failures.push(`assistant message ${row.id} contains a malformed tool call`);
        continue;
      }
      const fn = asRecord(rawCall.function);
      const name = fn ? readString(fn, "name") : undefined;
      const callId = readString(rawCall, "call_id") ?? readString(rawCall, "id");
      if (!name) failures.push(`assistant message ${row.id} tool call has no name`);
      else parsedNames.push(name);
      if (!callId || !resultIds.has(callId)) {
        failures.push(`assistant message ${row.id} tool call has no matching result`);
      }
      parsedCalls += 1;
    }
  }
  if (parsedCalls === 0) failures.push("Hermes session has no model-visible browser calls");
  if (artifact.toolCallCount !== parsedCalls) {
    failures.push(
      `stored tool_call_count ${artifact.toolCallCount} disagrees with ${parsedCalls} parsed calls`,
    );
  }
  const allowedNames = new Set(EXPECTED_TOOL_SCHEMAS[artifact.surface].names);
  const unexpectedNames = parsedNames.filter((name) => !allowedNames.has(name));
  if (unexpectedNames.length > 0) {
    failures.push(`unexpected model-visible tools: ${[...new Set(unexpectedNames)].join(", ")}`);
  }

  const expectedSchema = EXPECTED_TOOL_SCHEMAS[artifact.surface];
  if (!artifact.toolSchema) {
    failures.push("exact model-visible tool schema was not captured");
  } else if (
    artifact.toolSchema.bytes !== expectedSchema.bytes ||
    artifact.toolSchema.names.length !== expectedSchema.names.length ||
    [...artifact.toolSchema.names].sort().join("\n") !== [...expectedSchema.names].sort().join("\n")
  ) {
    failures.push(
      `model-visible tool schema drifted: ${artifact.toolSchema.bytes} bytes [${artifact.toolSchema.names.join(", ")}]`,
    );
  }

  if ((artifact.toolMetrics?.length ?? 0) !== parsedCalls) {
    failures.push(
      `tool metrics count ${artifact.toolMetrics?.length ?? 0} disagrees with ${parsedCalls} parsed calls`,
    );
  }
  for (const [index, metric] of (artifact.toolMetrics ?? []).entries()) {
    if (typeof metric.success !== "boolean") {
      failures.push(`tool metric ${index + 1} has no boolean success status`);
      continue;
    }
    if (metric.success === true) {
      const evidence = artifact.stepObservations?.[index];
      if (!evidence?.screenshot || !evidence.url?.startsWith("https://")) {
        failures.push(
          `successful tool call ${index + 1} has no independently captured HTTPS URL and screenshot`,
        );
      }
    }
    if (metric.success === true && metric.evidence_error) {
      failures.push(`evidence capture: ${String(metric.evidence_error)}`);
    }
  }
  const inner = artifact.innerUsage ?? emptyUsage(false);
  if (
    inner.input_tokens +
      inner.output_tokens +
      inner.cache_read_tokens +
      inner.cache_write_tokens +
      inner.reasoning_tokens >
    0
  ) {
    failures.push("Stagehand inner model usage is forbidden");
  }
  if (failures.length > 0) {
    throw new EvalsError(`Hermes artifact is not benchmark-scorable: ${failures.join("; ")}`);
  }
}

export async function runHermesAgent(input: HermesRunnerInput): Promise<TaskResult> {
  const artifact = await executeHermes(input);
  return gradeHermesArtifact({
    artifact,
    taskSpec: input.taskSpec,
    logger: input.logger,
    verifier: input.verifier,
  });
}

/**
 * Regrade an already-completed Hermes artifact without launching Hermes, a
 * browser, or the agent model again. This is the recovery path for verifier
 * outages after an expensive trajectory has completed successfully.
 */
export async function gradeHermesArtifact(input: HermesArtifactGradeInput): Promise<TaskResult> {
  const { artifact } = input;
  const finalAnswer = [...artifact.messages]
    .reverse()
    .find((row) => row.role === "assistant" && !row.tool_calls && row.content?.trim())
    ?.content?.trim();
  const completed =
    artifact.exitCode === 0 && artifact.usage.completed === true && artifact.usage.failed !== true;
  const innerUsage = artifact.innerUsage ?? emptyUsage(false);
  const combinedUsage = addUsage(artifact.usage, innerUsage);
  const baseResult: TaskResult = {
    _success: completed,
    ...(!completed && {
      error: artifact.stderr.trim() || `Hermes exited with status ${artifact.exitCode}`,
    }),
    finalAnswer: finalAnswer || artifact.stdout.trim() || undefined,
    rawResult: artifact.stdout,
    hermesSurface: artifact.surface,
    hermesProvider: HERMES_PROVIDER,
    toolCallCount: artifact.toolCallCount,
    ...(artifact.artifactDir && { hermesArtifactDir: artifact.artifactDir }),
    rawMetrics: {
      outer: artifact.usage,
      inner: innerUsage,
      combined: combinedUsage,
      tool_call_count: artifact.toolCallCount,
      tool_schema: artifact.toolSchema,
      agent_wall_ms: artifact.agentWallMs,
      browser_wall_ms: artifact.browserWallMs,
      session_setup_ms: artifact.sessionSetupMs,
    },
    logs: input.logger.getLogs(),
  };

  const verifierStartedAt = Date.now();
  const graded = await gradeExternalTrajectory({
    buildTrajectory: () => {
      validateHermesArtifact(artifact);
      return hermesArtifactToTrajectory(artifact, input.taskSpec);
    },
    verifier: input.verifier,
    baseResult,
    errorMessage: "Hermes trajectory did not satisfy the benchmark rubric",
    category: "hermes",
    logger: input.logger,
    failClosedOnVerifierError: true,
  });
  return {
    ...graded,
    rawMetrics: {
      ...asRecord(graded.rawMetrics),
      verifier_wall_ms: Date.now() - verifierStartedAt,
    },
  };
}

/** Load the immutable inputs required to replay grading from a retained run directory. */
export async function loadHermesArtifactDirectory(
  artifactDirectory: string,
  surface: HermesBrowserSurface,
): Promise<HermesRunArtifact> {
  const artifactDir = path.resolve(artifactDirectory);
  const usagePath = path.join(artifactDir, "usage.json");
  const stateDb = path.join(artifactDir, "hermes-home", "state.db");
  const evidenceDir = path.join(artifactDir, "evidence");
  for (const required of [usagePath, stateDb, evidenceDir]) {
    if (!fs.existsSync(required)) {
      throw new EvalsError(`Retained Hermes artifact is missing: ${required}`);
    }
  }

  const usage = await readUsage(usagePath);
  const { messages, toolCallCount } = readHermesState(stateDb, usage.session_id);
  if (messages.length === 0) {
    throw new EvalsError(`Retained Hermes artifact has no session messages: ${artifactDir}`);
  }
  const finalObservation = await readFinalObservation(evidenceDir);
  const stepObservations = await readStepObservations(evidenceDir);
  const toolMetrics = await readToolMetrics(evidenceDir);
  const innerUsage = readStagehandInnerUsage(toolMetrics);
  const toolSchema = await readToolSchemaArtifact(path.join(artifactDir, "tool-schema.json"));
  const retainedTiming = await readRetainedTiming(artifactDir);
  const completed = usage.completed === true && usage.failed !== true;

  return {
    surface,
    stdout: "",
    stderr: completed ? "" : "Retained Hermes usage does not mark the run complete.",
    exitCode: completed ? 0 : 1,
    messages,
    usage,
    innerUsage,
    toolCallCount,
    toolMetrics,
    ...(toolSchema && { toolSchema }),
    ...retainedTiming,
    ...(finalObservation && { finalObservation }),
    ...(stepObservations.length > 0 && { stepObservations }),
    artifactDir,
  };
}

async function executeHermes(input: HermesRunnerInput): Promise<HermesRunArtifact> {
  const root = resolveHermesRoot();
  validateHermesBenchmarkRoot(root);
  const stagehandV4Root =
    input.surface === "hermes_stagehand_batch" ? resolvePinnedStagehandV4Root() : undefined;
  const python =
    process.env.EVAL_HERMES_PYTHON?.trim() || path.join(root, ".venv", "bin", "python");
  const hermesEntrypoint = path.join(root, "hermes");
  for (const required of [python, hermesEntrypoint]) {
    if (!fs.existsSync(required)) {
      throw new EvalsError(`Hermes harness prerequisite is missing: ${required}`);
    }
  }
  if (input.surface === "hermes_stagehand_batch") {
    for (const required of [
      path.join(root, ".stagehand-venv", "bin", "python"),
      path.join(stagehandV4Root!, "packages", "sdk-python"),
    ]) {
      if (!fs.existsSync(required)) {
        throw new EvalsError(`Hermes Stagehand batch prerequisite is missing: ${required}`);
      }
    }
  }
  if (!process.env.AI_GATEWAY_API_KEY?.trim()) {
    throw new EvalsError("Hermes harness uses Vercel AI Gateway and requires AI_GATEWAY_API_KEY.");
  }
  if (input.environment === "BROWSERBASE" && !process.env.BROWSERBASE_API_KEY?.trim()) {
    throw new EvalsError("Hermes Browserbase runs require BROWSERBASE_API_KEY.");
  }

  const artifactRoot = process.env.EVAL_HERMES_ARTIFACT_ROOT?.trim();
  const runDir = artifactRoot
    ? await fsp.mkdtemp(path.join(await ensureDirectory(artifactRoot), "hermes-eval-"))
    : await fsp.mkdtemp(path.join(os.tmpdir(), "stagehand-evals-hermes-"));
  const preserve = Boolean(artifactRoot);
  const hermesHome = path.join(runDir, "hermes-home");
  const evidenceDir = path.join(runDir, "evidence");
  const cwd = path.join(runDir, "workspace");
  await Promise.all([
    fsp.mkdir(hermesHome, { recursive: true }),
    fsp.mkdir(evidenceDir, { recursive: true }),
    fsp.mkdir(cwd, { recursive: true }),
  ]);
  await fsp.writeFile(
    path.join(hermesHome, "config.yaml"),
    buildHermesConfig(input.surface, input.environment, root, stagehandV4Root),
    "utf8",
  );

  const usagePath = path.join(runDir, "usage.json");
  const childBaseEnvironment = buildHermesChildBaseEnvironment(process.env);
  const browserbaseEnvironment =
    input.environment === "BROWSERBASE" && input.surface !== "hermes_stagehand_batch"
      ? await resolveBrowserbaseChildEnvironment(childBaseEnvironment)
      : childBaseEnvironment;
  const env: NodeJS.ProcessEnv = {
    ...browserbaseEnvironment,
    HERMES_HOME: hermesHome,
    HERMES_YOLO_MODE: "1",
    HERMES_ACCEPT_HOOKS: "1",
    HERMES_BENCHMARK_EVIDENCE_DIR: evidenceDir,
    HERMES_BENCHMARK_EVIDENCE_HISTORY: "1",
    HERMES_BENCHMARK_TASK_ID: input.plan.taskId ?? input.taskSpec.id,
    BROWSERBASE_KEEP_ALIVE: "false",
  };
  applyHermesSurfaceEnvironment(env, input.surface, root);

  input.logger.log({
    category: "hermes",
    message: `Starting ${input.surface} through ${HERMES_PROVIDER} (${input.model}).`,
    level: 1,
  });

  let explicitSession: { id: string; cdpUrl: string } | undefined;
  const agentStartedAt = Date.now();
  let sessionSetupMs = 0;
  try {
    if (input.surface === "hermes_browser_legacy" && input.environment === "BROWSERBASE") {
      const sessionStartedAt = Date.now();
      explicitSession = await createBrowserbaseBenchmarkSession(env);
      sessionSetupMs = Date.now() - sessionStartedAt;
      env.BROWSER_CDP_URL = explicitSession.cdpUrl;
    }
    const toolSchema = await resolveHermesToolSchema({
      python,
      cwd,
      env,
      surface: input.surface,
    });
    await fsp.writeFile(
      path.join(runDir, "tool-schema.json"),
      `${JSON.stringify(toolSchema, null, 2)}\n`,
      "utf8",
    );
    const processResult = await runProcess(
      python,
      [
        hermesEntrypoint,
        "--provider",
        HERMES_PROVIDER,
        "--model",
        String(input.model),
        "--toolsets",
        input.surface === "hermes_browser_legacy" ? "browser" : "browser-use",
        "--usage-file",
        usagePath,
        "--oneshot",
        buildHermesPrompt(input.plan),
      ],
      {
        cwd,
        env,
        signal: input.signal,
        timeoutMs: readPositiveIntEnv("EVAL_HERMES_TIMEOUT_MS", 30 * 60_000),
      },
    );
    const usage = await readUsage(usagePath);
    const stateDb = path.join(hermesHome, "state.db");
    const { messages, toolCallCount } = fs.existsSync(stateDb)
      ? readHermesState(stateDb, usage.session_id)
      : { messages: [], toolCallCount: 0 };
    const finalObservation = await readFinalObservation(evidenceDir);
    const stepObservations = await readStepObservations(evidenceDir);
    const toolMetrics = await readToolMetrics(evidenceDir);
    const innerUsage = readStagehandInnerUsage(toolMetrics);
    const browserWallMs = toolMetrics.reduce(
      (total, metric) => total + nonnegativeInt(metric.duration_ms),
      0,
    );

    return {
      surface: input.surface,
      ...processResult,
      messages,
      usage,
      innerUsage,
      toolCallCount,
      toolSchema,
      toolMetrics,
      agentWallMs: Date.now() - agentStartedAt,
      browserWallMs,
      sessionSetupMs,
      ...(finalObservation && { finalObservation }),
      ...(stepObservations.length > 0 && { stepObservations }),
      ...(preserve && { artifactDir: runDir }),
    };
  } finally {
    if (explicitSession) await releaseBrowserbaseBenchmarkSession(env, explicitSession.id);
    if (!preserve) {
      await fsp.rm(runDir, { recursive: true, force: true });
    }
  }
}

function buildHermesConfig(
  surface: HermesBrowserSurface,
  environment: "LOCAL" | "BROWSERBASE",
  hermesRoot: string,
  stagehandV4Root?: string,
): string {
  const browserLines = ["browser:"];
  if (surface === "hermes_browser_exec") browserLines.push("  backend: browser-use");
  if (surface === "hermes_stagehand_batch") {
    if (!stagehandV4Root) {
      throw new EvalsError("Hermes Stagehand batch requires a validated Stagehand V4 root.");
    }
    browserLines.push("  backend: stagehand-batch");
    browserLines.push(
      `  stagehand_sdk_python_path: ${path.join(stagehandV4Root, "packages", "sdk-python")}`,
    );
    browserLines.push(
      `  stagehand_python_executable: ${path.join(hermesRoot, ".stagehand-venv", "bin", "python")}`,
    );
  } else if (environment === "BROWSERBASE") {
    browserLines.push("  cloud_provider: browserbase");
  }
  return `${browserLines.join("\n")}\n`;
}

function resolveHermesRoot(): string {
  return path.resolve(
    process.env.EVAL_HERMES_ROOT?.trim() ||
      path.join(getRepoRootDir(), "..", "hermes-stagehand-batch"),
  );
}

export function resolvePinnedStagehandV4Root(): string {
  const configured = process.env.EVAL_STAGEHAND_V4_ROOT?.trim();
  return validatePinnedStagehandV4Root(configured || DEFAULT_STAGEHAND_V4_ROOT);
}

export function validatePinnedStagehandV4Root(
  candidate: string,
  expectedCommit = PINNED_STAGEHAND_V4_COMMIT,
): string {
  const root = path.resolve(candidate);
  const sdkRoot = path.join(root, "packages", "sdk-python");
  if (!fs.existsSync(sdkRoot)) {
    throw new EvalsError(`Pinned Stagehand V4 Python SDK is missing: ${sdkRoot}`);
  }

  let head: string;
  let status: string;
  try {
    head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    status = execFileSync("git", ["-C", root, "status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (cause) {
    throw new EvalsError(`Unable to validate pinned Stagehand V4 checkout at ${root}.`, {
      cause,
    });
  }

  if (head !== expectedCommit) {
    throw new EvalsError(
      `Stagehand V4 checkout ${root} is at ${head}; expected pinned commit ${expectedCommit}.`,
    );
  }
  if (status) {
    throw new EvalsError(
      `Stagehand V4 checkout ${root} has local changes; use a clean checkout of ${expectedCommit}.`,
    );
  }
  return root;
}

export function validateHermesBenchmarkRoot(
  candidate: string,
  expectedBaseCommit = PINNED_HERMES_BASE_COMMIT,
): string {
  const root = path.resolve(candidate);
  if (validatedHermesRoots.has(root)) return root;
  const python = path.join(root, ".browser-use-venv", "bin", "python");
  const browserUseCli = path.join(root, ".browser-use-venv", "bin", "browser-use");
  const agentBrowser = path.join(
    root,
    ".browser-use-node",
    "node_modules",
    ".bin",
    "agent-browser",
  );
  const skill = path.join(root, "benchmarks", "browser-use-full-skill-0.1.8.md");
  const nodeLock = path.join(root, "benchmarks", "browser-use-node-package-lock.json");
  for (const required of [
    path.join(root, "hermes"),
    python,
    browserUseCli,
    agentBrowser,
    skill,
    nodeLock,
  ]) {
    if (!fs.existsSync(required)) {
      throw new EvalsError(`Pinned Hermes benchmark prerequisite is missing: ${required}`);
    }
  }
  try {
    execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", expectedBaseCommit, "HEAD"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const versions = execFileSync(
      python,
      [
        "-c",
        "from importlib import metadata; print(metadata.version('browser-use')); print(metadata.version('browser-harness'))",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
      .trim()
      .split(/\r?\n/);
    if (
      versions[0] !== PINNED_BROWSER_USE.packageVersion ||
      versions[1] !== PINNED_BROWSER_USE.harnessVersion
    ) {
      throw new Error(`Browser Use versions drifted: ${versions.join(", ")}`);
    }
    const freeze = execFileSync(python, ["-m", "pip", "freeze"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (sha256(freeze) !== PINNED_BROWSER_USE.freezeSha256) {
      throw new Error("Browser Use environment freeze drifted");
    }
    execFileSync(python, ["-m", "pip", "check"], { stdio: ["ignore", "pipe", "pipe"] });
    const browserUseVersion = execFileSync(browserUseCli, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (browserUseVersion !== PINNED_BROWSER_USE.harnessVersion) {
      throw new Error(`Browser Use CLI drifted: ${browserUseVersion}`);
    }
    const nodeVersion = execFileSync(agentBrowser, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (nodeVersion !== PINNED_BROWSER_USE.nodeVersion) {
      throw new Error(`agent-browser drifted: ${nodeVersion}`);
    }
    const skillBytes = fs.statSync(skill).size;
    if (
      skillBytes !== PINNED_BROWSER_USE.skillBytes ||
      sha256(fs.readFileSync(skill)) !== PINNED_BROWSER_USE.skillSha256
    ) {
      throw new Error("full Browser Use skill snapshot drifted");
    }
    if (sha256(fs.readFileSync(nodeLock)) !== PINNED_BROWSER_USE.nodeLockSha256) {
      throw new Error("agent-browser lockfile drifted");
    }
  } catch (cause) {
    throw new EvalsError(
      `Hermes benchmark checkout ${root} does not satisfy the frozen source/runtime pins.`,
      { cause },
    );
  }
  validatedHermesRoots.add(root);
  return root;
}

async function resolveBrowserbaseChildEnvironment(
  base: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  if (base.BROWSERBASE_PROJECT_ID?.trim()) return { ...base };
  const apiKey = base.BROWSERBASE_API_KEY?.trim();
  if (!apiKey) throw new EvalsError("Hermes Browserbase runs require BROWSERBASE_API_KEY.");
  let response: Response;
  try {
    response = await fetch("https://api.browserbase.com/v1/projects", {
      headers: { "X-BB-API-Key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    throw new EvalsError("Browserbase project discovery failed.", { cause });
  }
  if (!response.ok) {
    throw new EvalsError(`Browserbase project discovery returned HTTP ${response.status}.`);
  }
  const payload = (await response.json()) as unknown;
  const record = asRecord(payload);
  const projects = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.projects)
      ? record.projects
      : [];
  if (projects.length !== 1) {
    throw new EvalsError(
      `Browserbase project discovery requires exactly one visible project; found ${projects.length}.`,
    );
  }
  const projectId = readString(asRecord(projects[0]), "id");
  if (!projectId)
    throw new EvalsError("Browserbase project discovery returned an invalid project.");
  return { ...base, BROWSERBASE_PROJECT_ID: projectId };
}

function buildHermesChildBaseEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = [
    "PATH",
    "LANG",
    "LC_ALL",
    "TERM",
    "TZ",
    "TMPDIR",
    "HOME",
    "USER",
    "LOGNAME",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "AI_GATEWAY_API_KEY",
    "AI_GATEWAY_BASE_URL",
    "BROWSERBASE_API_KEY",
    "BROWSERBASE_PROJECT_ID",
    "BROWSERBASE_BASE_URL",
    "BROWSERBASE_REGION",
  ] as const;
  const child: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    if (base[key] !== undefined) child[key] = base[key];
  }
  return child;
}

async function createBrowserbaseBenchmarkSession(
  env: NodeJS.ProcessEnv,
): Promise<{ id: string; cdpUrl: string }> {
  const apiKey = env.BROWSERBASE_API_KEY?.trim();
  const projectId = env.BROWSERBASE_PROJECT_ID?.trim();
  if (!apiKey || !projectId) {
    throw new EvalsError("Explicit Browserbase benchmark session requires API key and project ID.");
  }
  const baseUrl = (env.BROWSERBASE_BASE_URL?.trim() || "https://api.browserbase.com").replace(
    /\/$/,
    "",
  );
  const create = async (proxies: boolean): Promise<Response> =>
    fetch(`${baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BB-API-Key": apiKey },
      body: JSON.stringify({ projectId, ...(proxies && { proxies: true }) }),
      signal: AbortSignal.timeout(30_000),
    });
  let response: Response;
  try {
    response = await create(true);
    if (response.status === 402) response = await create(false);
  } catch (cause) {
    throw new EvalsError("Browserbase benchmark session creation failed.", { cause });
  }
  if (!response.ok) {
    throw new EvalsError(
      `Browserbase benchmark session creation returned HTTP ${response.status}.`,
    );
  }
  const value = asRecord((await response.json()) as unknown);
  const id = readString(value, "id");
  const cdpUrl = readString(value, "connectUrl");
  if (!id || !cdpUrl || !/^wss?:\/\//.test(cdpUrl)) {
    throw new EvalsError("Browserbase benchmark session response was malformed.");
  }
  return { id, cdpUrl };
}

async function releaseBrowserbaseBenchmarkSession(
  env: NodeJS.ProcessEnv,
  sessionId: string,
): Promise<void> {
  const apiKey = env.BROWSERBASE_API_KEY?.trim();
  const projectId = env.BROWSERBASE_PROJECT_ID?.trim();
  if (!apiKey || !projectId || !sessionId) {
    throw new EvalsError("Cannot release the explicit Browserbase benchmark session.");
  }
  const baseUrl = (env.BROWSERBASE_BASE_URL?.trim() || "https://api.browserbase.com").replace(
    /\/$/,
    "",
  );
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/sessions/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BB-API-Key": apiKey },
      body: JSON.stringify({ projectId, status: "REQUEST_RELEASE" }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (cause) {
    throw new EvalsError("Browserbase benchmark session release failed.", { cause });
  }
  if (!response.ok) {
    throw new EvalsError(`Browserbase benchmark session release returned HTTP ${response.status}.`);
  }
}

export async function resolveHermesToolSchema(input: {
  python: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  surface: HermesBrowserSurface;
}): Promise<HermesToolSchema> {
  const toolset = input.surface === "hermes_browser_legacy" ? "browser" : "browser-use";
  const source = [
    "import json",
    "from hermes_cli.oneshot import _validate_explicit_toolsets",
    `valid,error=_validate_explicit_toolsets(${JSON.stringify(toolset)})`,
    "assert error is None and valid is not None",
    "import model_tools",
    "definitions=model_tools.get_tool_definitions(enabled_toolsets=valid,quiet_mode=True,skip_tool_search_assembly=True)",
    "canonical=json.dumps({'tools':definitions},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')",
    `print(${JSON.stringify(TOOL_SCHEMA_PREFIX)}+json.dumps({'bytes':len(canonical),'names':[item.get('function',{}).get('name') for item in definitions]},sort_keys=True,separators=(',',':')))`,
  ].join("\n");
  const result = await runProcess(input.python, ["-c", source], {
    cwd: input.cwd,
    env: input.env,
    timeoutMs: 60_000,
  });
  const line = result.stdout
    .split(/\r?\n/)
    .reverse()
    .find((candidate) => candidate.startsWith(TOOL_SCHEMA_PREFIX));
  if (result.exitCode !== 0 || !line) {
    throw new EvalsError("Could not resolve the exact Hermes model-visible tool schema.");
  }
  const value = JSON.parse(line.slice(TOOL_SCHEMA_PREFIX.length)) as Record<string, unknown>;
  const schema: HermesToolSchema = {
    bytes: nonnegativeInt(value.bytes),
    names: Array.isArray(value.names)
      ? value.names.filter((name): name is string => typeof name === "string")
      : [],
  };
  const expected = EXPECTED_TOOL_SCHEMAS[input.surface];
  if (
    schema.bytes !== expected.bytes ||
    [...schema.names].sort().join("\n") !== [...expected.names].sort().join("\n")
  ) {
    throw new EvalsError(
      `Unexpected Hermes tool schema for ${input.surface}: ${schema.bytes} bytes [${schema.names.join(", ")}].`,
    );
  }
  return schema;
}

function sha256(value: Uint8Array): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function ensureDirectory(directory: string): Promise<string> {
  const resolved = path.resolve(directory);
  await fsp.mkdir(resolved, { recursive: true });
  return resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;
}

function runProcess(
  executable: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs: number },
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    execFile(
      executable,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        signal: options.signal,
        timeout: options.timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        const errorCode = asRecord(error)?.code;
        const exitCode = typeof errorCode === "number" ? errorCode : error ? 1 : 0;
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode });
      },
    );
  });
}

async function readUsage(usagePath: string): Promise<HermesUsage> {
  if (!fs.existsSync(usagePath)) {
    return emptyUsage();
  }
  const raw = JSON.parse(await fsp.readFile(usagePath, "utf8")) as Record<string, unknown>;
  const usageNumber = (key: string): number => {
    const value = raw[key];
    if (value == null) return 0;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new EvalsError(`Hermes usage field ${key} is invalid.`);
    }
    return Math.trunc(value);
  };
  const estimatedCost = raw.estimated_cost_usd;
  if (
    estimatedCost != null &&
    (typeof estimatedCost !== "number" || !Number.isFinite(estimatedCost) || estimatedCost < 0)
  ) {
    throw new EvalsError("Hermes estimated_cost_usd is invalid.");
  }
  return {
    input_tokens: usageNumber("input_tokens"),
    output_tokens: usageNumber("output_tokens"),
    cache_read_tokens: usageNumber("cache_read_tokens"),
    cache_write_tokens: usageNumber("cache_write_tokens"),
    reasoning_tokens: usageNumber("reasoning_tokens"),
    api_calls: usageNumber("api_calls"),
    ...(typeof estimatedCost === "number" && {
      estimated_cost_usd: estimatedCost,
    }),
    ...(typeof raw.session_id === "string" && { session_id: raw.session_id }),
    ...(typeof raw.completed === "boolean" && { completed: raw.completed }),
    ...(typeof raw.failed === "boolean" && { failed: raw.failed }),
  };
}

function emptyUsage(failed = true): HermesUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    api_calls: 0,
    ...(failed && { failed: true }),
  };
}

function addUsage(left: HermesUsage, right: HermesUsage): HermesUsage {
  return {
    input_tokens: left.input_tokens + right.input_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
    cache_read_tokens: left.cache_read_tokens + right.cache_read_tokens,
    cache_write_tokens: left.cache_write_tokens + right.cache_write_tokens,
    reasoning_tokens: left.reasoning_tokens + right.reasoning_tokens,
    api_calls: left.api_calls + right.api_calls,
  };
}

async function readToolMetrics(evidenceDir: string): Promise<Array<Record<string, unknown>>> {
  const metricsPath = path.join(evidenceDir, "tool-metrics.jsonl");
  if (!fs.existsSync(metricsPath)) return [];
  const rows: Array<Record<string, unknown>> = [];
  let lineNumber = 0;
  for (const line of (await fsp.readFile(metricsPath, "utf8")).split(/\r?\n/)) {
    lineNumber += 1;
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      throw new EvalsError(`Malformed Hermes tool metric at line ${lineNumber}.`, { cause });
    }
    if (!isRecord(parsed)) {
      throw new EvalsError(`Hermes tool metric at line ${lineNumber} is not an object.`);
    }
    rows.push(parsed);
  }
  return rows;
}

function readStagehandInnerUsage(metrics: Array<Record<string, unknown>>): HermesUsage {
  const usage = emptyUsage(false);
  const fieldMap = {
    total_prompt_tokens: "input_tokens",
    total_completion_tokens: "output_tokens",
    total_cached_input_tokens: "cache_read_tokens",
    total_reasoning_tokens: "reasoning_tokens",
  } as const;
  for (const metric of metrics) {
    const stagehand = asRecord(metric.stagehand_metrics);
    const delta = asRecord(stagehand?.delta);
    if (!delta) continue;
    for (const [source, destination] of Object.entries(fieldMap)) {
      usage[destination] += nonnegativeInt(delta[source]);
    }
  }
  return usage;
}

async function readToolSchemaArtifact(schemaPath: string): Promise<HermesToolSchema | undefined> {
  if (!fs.existsSync(schemaPath)) return undefined;
  const value = JSON.parse(await fsp.readFile(schemaPath, "utf8")) as Record<string, unknown>;
  return {
    bytes: nonnegativeInt(value.bytes),
    names: Array.isArray(value.names)
      ? value.names.filter((name): name is string => typeof name === "string")
      : [],
  };
}

async function readRetainedTiming(
  artifactDir: string,
): Promise<Pick<HermesRunArtifact, "agentWallMs" | "browserWallMs" | "sessionSetupMs">> {
  const recordPath = path.join(artifactDir, "record.json");
  if (!fs.existsSync(recordPath)) return {};
  const record = JSON.parse(await fsp.readFile(recordPath, "utf8")) as Record<string, unknown>;
  const timing = asRecord(record.timing);
  const agentWallMs = nonnegativeInt(timing?.agent_wall_ms);
  const browserWallMs = nonnegativeInt(timing?.browser_wall_ms);
  const sessionSetupMs = nonnegativeInt(timing?.session_setup_ms);
  return {
    ...(agentWallMs > 0 && { agentWallMs }),
    ...(browserWallMs > 0 && { browserWallMs }),
    ...(sessionSetupMs > 0 && { sessionSetupMs }),
  };
}

function readHermesState(
  databasePath: string,
  requestedSessionId?: string,
): { messages: HermesMessageRow[]; toolCallCount: number } {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const session = requestedSessionId
      ? database
          .prepare("SELECT id, tool_call_count FROM sessions WHERE id = ?")
          .get(requestedSessionId)
      : database
          .prepare("SELECT id, tool_call_count FROM sessions ORDER BY started_at DESC LIMIT 1")
          .get();
    const sessionRecord = asRecord(session);
    const sessionId = readString(sessionRecord, "id");
    if (!sessionId) return { messages: [], toolCallCount: 0 };
    const rows = database
      .prepare(
        "SELECT id, role, content, tool_call_id, tool_calls, tool_name, reasoning, reasoning_content FROM messages WHERE session_id = ? ORDER BY id",
      )
      .all(sessionId) as unknown as HermesMessageRow[];
    return {
      messages: rows,
      toolCallCount: nonnegativeInt(sessionRecord?.tool_call_count),
    };
  } finally {
    database.close();
  }
}

async function readFinalObservation(evidenceDir: string): Promise<ProbeEvidence | undefined> {
  const screenshotPath = path.join(evidenceDir, "screenshot.png");
  if (!fs.existsSync(screenshotPath)) return undefined;
  const finalUrlPath = path.join(evidenceDir, "final-url.txt");
  return {
    screenshot: await fsp.readFile(screenshotPath),
    ...(fs.existsSync(finalUrlPath) && {
      url: (await fsp.readFile(finalUrlPath, "utf8")).trim(),
    }),
  };
}

async function readStepObservations(
  evidenceDir: string,
): Promise<Array<ProbeEvidence | undefined>> {
  const stepsDir = path.join(evidenceDir, "steps");
  if (!fs.existsSync(stepsDir)) return [];
  const metadataFiles = (await fsp.readdir(stepsDir))
    .filter((name) => /^step-\d+\.json$/.test(name))
    .sort();
  const observations: Array<ProbeEvidence | undefined> = [];
  for (const filename of metadataFiles) {
    try {
      const metadata = JSON.parse(
        await fsp.readFile(path.join(stepsDir, filename), "utf8"),
      ) as Record<string, unknown>;
      const actionIndex = nonnegativeInt(metadata.action_index);
      const screenshotName = readString(metadata, "screenshot");
      if (actionIndex < 1 || !screenshotName || path.basename(screenshotName) !== screenshotName) {
        continue;
      }
      const screenshotPath = path.join(stepsDir, screenshotName);
      if (!fs.existsSync(screenshotPath)) continue;
      observations[actionIndex - 1] = {
        screenshot: await fsp.readFile(screenshotPath),
        ...(readString(metadata, "final_url") && {
          url: readString(metadata, "final_url"),
        }),
      };
    } catch {
      // One malformed frame must not discard other independently captured evidence.
    }
  }
  return observations;
}

function parseToolCalls(value: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return { raw: value };
  }
}

function parseHermesToolResult(content: string): {
  value: unknown;
  ok: boolean;
  error?: string;
} {
  const match = content.match(
    /<untrusted_tool_result[^>]*>\s*[\s\S]*?\n\n([\s\S]*?)\s*<\/untrusted_tool_result>/,
  );
  const candidate = match?.[1]?.trim() ?? content.trim();
  try {
    const value = JSON.parse(candidate) as unknown;
    const record = asRecord(value);
    const ok = record?.success !== false && record?.error === undefined;
    return {
      value,
      ok,
      ...(!ok && { error: String(record?.error ?? "Hermes tool returned success=false") }),
    };
  } catch {
    return { value: content, ok: !/\b(?:error|failed)\b/i.test(content) };
  }
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const value = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonnegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function firstNonempty(...values: Array<string | null | undefined>): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function readString(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const item = value?.[key];
  return typeof item === "string" && item.length > 0 ? item : undefined;
}
