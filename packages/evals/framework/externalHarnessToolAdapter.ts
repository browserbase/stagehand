/**
 * externalHarnessToolAdapter — shared browse-CLI provisioning for the
 * bare-loop harnesses (vercel_ai_sdk, anthropic_sdk, openai_agents_sdk) and
 * cursor_sdk.
 *
 * Unlike claudeCodeToolAdapter.ts, these four harnesses only ever use the
 * `browse_cli` tool surface — none of them have a Claude-Code-style
 * playwright_code/cdp_code MCP path — so this module is intentionally a
 * thin wrapper around `prepareBrowseCliHarnessAdapter` (the same provisioning
 * codex uses) plus the one thing that IS new here: skill-delivery mode.
 *
 * Skill-delivery mode (`SkillDeliveryMode`) controls how (if at all) the
 * browse CLI's skill documentation reaches the agent (see
 * packages/evals/README.md#external-harnesses). It is orthogonal to which
 * harness is running:
 *   - "none": no skill content anywhere, just the bare one-line system
 *     prompt. This is the default — the bare-loop tier measures the browse
 *     CLI + docs with zero scaffolding compensating for gaps, so "no skill"
 *     is the natural baseline, not "inject it".
 *   - "prompt_show": the prompt instructs the agent to run
 *     `browse skills show` first. Requires a browse CLI release that
 *     includes `browse skills show` — buildSystemPromptAddendum warns with
 *     the installed version when the mode is selected.
 *   - "injected": the skill content is embedded directly in the system
 *     prompt. There is no Skill-tool primitive in a bare loop (there's only
 *     the one `browse` tool), so "injected" here means literally pasting
 *     the SKILL.md text into context up front, functionally equivalent to
 *     Claude Code's Skill-tool-loads-file outcome but delivered without a
 *     tool call.
 */
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  parseSkillDeliveryMode,
  type SkillDeliveryMode,
} from "./benchTypes.js";
import type { EvalLogger } from "../logger.js";
import { getRepoRootDir } from "../runtimePaths.js";
import type { StartupProfile } from "../core/contracts/tool.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import {
  isAllowedBrowseCommand,
  prepareBrowseCliHarnessAdapter,
  type BrowseCliToolMetadata,
} from "./claudeCodeToolAdapter.js";

const execFileAsync = promisify(execFile);

const BROWSER_SKILL_SOURCE = path.join(
  getRepoRootDir(),
  "packages",
  "evals",
  "skills",
  "browser",
  "SKILL.md",
);

/** Shown in the prompt_show warning: not every browse CLI release ships `browse skills show`. */
const SKILLS_SHOW_MIN_VERSION_HINT =
  "requires a browse CLI release that includes `browse skills show`";

export interface ExternalHarnessToolAdapterInput {
  environment: "LOCAL" | "BROWSERBASE";
  startupProfile?: StartupProfile;
  skillMode?: SkillDeliveryMode | string;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
  /** Logger category, e.g. "vercel_ai_sdk" | "anthropic_sdk" | "openai_agents_sdk" | "cursor_sdk". */
  logCategory: string;
}

export interface PreparedExternalHarnessAdapter {
  cwd: string;
  env: Record<string, string>;
  /** Absolute path to the per-run browse wrapper executable. */
  browseBinPath: string;
  skillMode: SkillDeliveryMode;
  /** System-prompt text to prepend: bare one-liner, prompt_show instruction, or injected skill text. */
  systemPromptAddendum: string;
  metadata: BrowseCliToolMetadata;
  cleanup: () => Promise<void>;
}

export function resolveExternalHarnessStartupProfile(
  environment: "LOCAL" | "BROWSERBASE",
  requested?: StartupProfile,
): StartupProfile {
  if (requested) return requested;
  return environment === "BROWSERBASE"
    ? "tool_create_browserbase"
    : "tool_launch_local";
}

/**
 * The default bare-loop system prompt: the agent gets the browse CLI with no
 * documentation and must discover commands via `--help`. This exact wording
 * is the "no scaffolding" baseline the bare-loop results are measured
 * against — treat edits to it as changes to what the numbers mean.
 */
export const BARE_LOOP_DEFAULT_SYSTEM_PROMPT = [
  'You drive a real web browser by running the "browse" CLI, one command per tool call (e.g. "open https://example.com" or "get markdown body").',
  "You have not used this CLI before and have no documentation for it beyond what you discover yourself.",
  'Figure out its exact commands and flags by running "--help" and "<command> --help" as needed -- do this before/while working the task, not just once up front.',
].join(" ");

const PROMPT_SHOW_SYSTEM_PROMPT_ADDENDUM =
  'Before doing anything else, run the browse tool with args "skills show" (i.e. `browse skills show`) to print this CLI\'s bundled skill documentation, then follow it.';

export async function prepareExternalHarnessAdapter(
  input: ExternalHarnessToolAdapterInput,
): Promise<PreparedExternalHarnessAdapter> {
  const skillMode = parseSkillDeliveryMode(input.skillMode);
  const startupProfile = resolveExternalHarnessStartupProfile(
    input.environment,
    input.startupProfile,
  );

  const adapter = await prepareBrowseCliHarnessAdapter({
    startupProfile,
    environment: input.environment,
    plan: input.plan,
    logger: input.logger,
    logCategory: input.logCategory,
  });

  const systemPromptAddendum = await buildSystemPromptAddendum(
    skillMode,
    input.logger,
    input.logCategory,
    adapter.metadata,
  );

  return {
    cwd: adapter.cwd,
    env: adapter.env,
    // prepareBrowseCliHarnessAdapter always writes the per-run wrapper at
    // <cwd>/browse and prefixes PATH with cwd — this is a stable contract of
    // that function, not re-derived logic.
    browseBinPath: path.join(adapter.cwd, "browse"),
    skillMode,
    systemPromptAddendum,
    metadata: adapter.metadata,
    cleanup: adapter.cleanup,
  };
}

async function buildSystemPromptAddendum(
  skillMode: SkillDeliveryMode,
  logger: EvalLogger,
  logCategory: string,
  metadata: BrowseCliToolMetadata,
): Promise<string> {
  switch (skillMode) {
    case "none":
      return BARE_LOOP_DEFAULT_SYSTEM_PROMPT;
    case "prompt_show":
      logger.warn({
        category: logCategory,
        message: `skillMode=prompt_show ${SKILLS_SHOW_MIN_VERSION_HINT}. Installed browse CLI version: ${
          metadata.browseCliVersion ?? "unknown"
        }. On releases without it, the agent cannot discover the skill.`,
        level: 0,
      });
      return `${BARE_LOOP_DEFAULT_SYSTEM_PROMPT}\n${PROMPT_SHOW_SYSTEM_PROMPT_ADDENDUM}`;
    case "injected": {
      const skillText = await fsp.readFile(BROWSER_SKILL_SOURCE, "utf8");
      return [
        BARE_LOOP_DEFAULT_SYSTEM_PROMPT,
        "The following skill documentation for this CLI has already been loaded for you:",
        "--- BEGIN SKILL ---",
        skillText.trim(),
        "--- END SKILL ---",
      ].join("\n");
    }
  }
}

/**
 * Tokenize a bare-loop tool call's `args` string into argv, respecting
 * single/double-quoted segments (e.g. `type "hello world"`). Deliberately
 * minimal — this is a reference instrument's tool surface, not a shell.
 */
export function tokenizeBrowseArgs(args: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(args)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

export interface RunBareBrowseCommandResult {
  ok: boolean;
  output: string;
}

/**
 * Execute a single browse CLI command on behalf of a bare-loop tool call.
 * `args` is everything after "browse " (e.g. "open https://example.com").
 * Reuses claudeCodeToolAdapter's `isAllowedBrowseCommand` gate — same
 * philosophy as Claude Code/Codex: one browse command per tool call, no
 * shell metacharacters.
 */
export async function runBareBrowseCommand(
  adapter: Pick<
    PreparedExternalHarnessAdapter,
    "browseBinPath" | "cwd" | "env"
  >,
  args: string,
  timeoutMs = 60_000,
): Promise<RunBareBrowseCommandResult> {
  const candidate = `browse ${args}`.trim();
  if (!isAllowedBrowseCommand(candidate)) {
    return {
      ok: false,
      output:
        "Rejected: only a single browse command with no shell metacharacters is allowed per tool call.",
    };
  }

  const argv = tokenizeBrowseArgs(args);
  try {
    const { stdout, stderr } = await execFileAsync(
      adapter.browseBinPath,
      argv,
      {
        cwd: adapter.cwd,
        env: adapter.env,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return { ok: true, output: (stdout || stderr).trim() };
  } catch (error) {
    const message = describeExecError(error);
    return { ok: false, output: `ERROR: ${message}` };
  }
}

function describeExecError(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as {
      stdout?: unknown;
      stderr?: unknown;
      message?: unknown;
    };
    const stdout = typeof record.stdout === "string" ? record.stdout : "";
    const stderr = typeof record.stderr === "string" ? record.stderr : "";
    const combined = `${stdout}${stderr}`.trim();
    if (combined) return clip(combined, 4000);
    if (typeof record.message === "string") return record.message;
  }
  return String(error);
}

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}
