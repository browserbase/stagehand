/**
 * Antigravity session adapter: Google's Antigravity agent loop driven
 * headlessly through its Python SDK (`google-antigravity`).
 *
 * The Python runner in `../runner` speaks the Deep Agents JSONL event protocol,
 * so this adapter reuses the Deep Agents process driver (subprocess lifecycle,
 * event parsing, status mapping) and only owns what is Antigravity-specific:
 * where the runner lives, how model ids are normalized, and the system prompt
 * section that explains the runtime's saved-output handling to the agent.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runDeepagentsSession,
  type DeepagentsMcpServerConfig,
  type DeepagentsProcessSpawner,
  type DeepagentsSessionResult,
} from "@browserbasehq/stagehand-integrations-deepagents-sdk";

export {
  buildDeepagentsTranscript as buildAntigravityTranscript,
  stringifyError,
  toFiniteNumber,
  type DeepagentsProcessSpawner as AntigravityProcessSpawner,
  type DeepagentsSessionResult as AntigravitySessionResult,
  type DeepagentsTokenUsage as AntigravityTokenUsage,
} from "@browserbasehq/stagehand-integrations-deepagents-sdk";

export const ANTIGRAVITY_DEFAULT_MODEL = "google/gemini-3.8-flash";

/** The bundled uv project; resolves the same from `src/` and from `dist/`. */
export const DEFAULT_ANTIGRAVITY_RUNNER_DIR = fileURLToPath(new URL("../runner/", import.meta.url));

export function resolveAntigravityRunnerDir(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return override ?? env.STAGEHAND_ANTIGRAVITY_RUNNER_DIR ?? DEFAULT_ANTIGRAVITY_RUNNER_DIR;
}

/** google-antigravity version pinned in the runner's uv.lock, if readable. */
export function readAntigravitySdkVersion(runnerDir: string): string | undefined {
  try {
    const lock = fs.readFileSync(path.join(runnerDir, "uv.lock"), "utf8");
    return /\[\[package\]\]\s*name = "google-antigravity"\s*version = "([^"]+)"/.exec(lock)?.[1];
  } catch {
    return undefined;
  }
}

const GOOGLE_MODEL_PREFIXES = ["google/", "google_genai:", "gemini:"];

/**
 * Strip a Google provider prefix (`google/x`, `google_genai:x`, `gemini:x` -> `x`).
 * Any other id passes through unchanged; the SDK rejects models it cannot run.
 */
export function normalizeAntigravityModel(model: string): string {
  const prefix = GOOGLE_MODEL_PREFIXES.find((candidate) => model.startsWith(candidate));
  return prefix ? model.slice(prefix.length) : model;
}

/** `EVAL_ANTIGRAVITY_THINKING_LEVEL`, read by the runner; undefined keeps the SDK default. */
export function readAntigravityThinkingLevel(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.EVAL_ANTIGRAVITY_THINKING_LEVEL?.trim().toLowerCase() || undefined;
}

/**
 * Appended to the eval system prompt for the Stagehand facade. The runtime saves
 * any tool output over about 4 KB to a file under its app-data `brain`
 * directory, so the runner leaves the builtin `view_file` enabled for that
 * directory only.
 */
export const ANTIGRAVITY_FACADE_SYSTEM_PROMPT = `You are controlling one persistent browser that is already attached.
Do not launch another browser. Only the browser tools matter for this task.
You control the browser through exactly three tools:
- snapshot: inspect the active page and hydrate bracketed element IDs.
- run: provide either snapshot actions or JavaScript using the Playwright-shaped page API.
- screenshot: inspect the rendered page visually.
Snapshot IDs are valid only for the latest snapshot of the active page. Snapshot again after
navigation or stale IDs.
Large tool outputs, such as page snapshots and long page text, are saved to a file instead of
being shown inline. Open that file with view_file to read it. view_file can read only those saved
outputs and the tool schemas.
Finish with the EVAL_RESULT line requested by the task prompt.
`;

export type AntigravitySessionConfig = {
  /** Runner project; defaults to `STAGEHAND_ANTIGRAVITY_RUNNER_DIR`, then the bundled runner. */
  runnerDir?: string;
  uvCommand?: string;
  cwd?: string;
  env?: Record<string, string>;
  mcpServers?: Record<string, DeepagentsMcpServerConfig>;
  systemPrompt?: string;
  /** Tool-call budget; `view_file` reads are not counted. */
  maxToolSteps?: number;
  killGraceMs?: number;
  streamDrainMs?: number;
};

export type AntigravitySessionInput = Omit<
  Parameters<typeof runDeepagentsSession>[0],
  "session" | "spawn"
> & {
  session: AntigravitySessionConfig;
  spawn?: DeepagentsProcessSpawner;
};

/** Run one Antigravity agent turn through the bundled (or overridden) Python runner. */
export async function runAntigravitySession(
  input: AntigravitySessionInput,
): Promise<DeepagentsSessionResult> {
  const { runnerDir, ...session } = input.session;
  return runDeepagentsSession({
    ...input,
    model: normalizeAntigravityModel(input.model),
    session: { ...session, runnerDir: resolveAntigravityRunnerDir(runnerDir) },
  });
}
