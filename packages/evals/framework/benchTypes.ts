import type { AgentToolMode, AvailableModel } from "@browserbasehq/stagehand";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";

export type Harness =
  | "stagehand"
  | "claude_code"
  | "codex"
  | "vercel_ai_sdk"
  | "anthropic_sdk"
  | "openai_agents_sdk"
  | "cursor_sdk";

export const DEFAULT_BENCH_HARNESS: Harness = "stagehand";

export const SUPPORTED_BENCH_HARNESSES = [
  "stagehand",
  "claude_code",
  "codex",
  "vercel_ai_sdk",
  "anthropic_sdk",
  "openai_agents_sdk",
  "cursor_sdk",
] as const satisfies readonly Harness[];

/**
 * Harnesses with a registered runner. The four new external harnesses are
 * parseable/plannable (dry-run works) from the scaffolding onward; each
 * becomes executable in the stacked PR that lands its runner.
 */
export const EXECUTABLE_BENCH_HARNESSES = [
  "stagehand",
  "claude_code",
  "codex",
  "vercel_ai_sdk",
  "anthropic_sdk",
  "openai_agents_sdk",
] as const satisfies readonly Harness[];

/**
 * The "bare loop" harnesses: a single generic tool-calling loop with no
 * agentic scaffolding beyond what the model provider's SDK gives for free.
 * Used to gate bare-loop-only behavior (system-prompt policy, skill-delivery
 * modes, step-cap defaults) without repeating the harness list everywhere.
 */
export const BARE_LOOP_HARNESSES = [
  "vercel_ai_sdk",
  "anthropic_sdk",
  "openai_agents_sdk",
] as const satisfies readonly Harness[];

export function isBareLoopHarness(harness: Harness): boolean {
  return (BARE_LOOP_HARNESSES as readonly Harness[]).includes(harness);
}

/**
 * External harnesses that only support the agent benchmark suites
 * (webvoyager / onlineMind2Web / webtailbench) via `buildExternalHarnessTaskPlan`
 * — i.e. everything except the native `stagehand` harness.
 */
export const EXTERNAL_HARNESSES = [
  "claude_code",
  "codex",
  "vercel_ai_sdk",
  "anthropic_sdk",
  "openai_agents_sdk",
  "cursor_sdk",
] as const satisfies readonly Harness[];

export function isExternalHarness(harness: Harness): boolean {
  return (EXTERNAL_HARNESSES as readonly Harness[]).includes(harness);
}

/**
 * Harnesses provisioned through `prepareExternalHarnessAdapter` (the
 * browse-only tool surface): the bare loops plus cursor_sdk. claude_code and
 * codex have their own provisioning and do not consume `skillMode`.
 */
export const ADAPTER_BACKED_HARNESSES = [
  ...BARE_LOOP_HARNESSES,
  "cursor_sdk",
] as const satisfies readonly Harness[];

export type AdapterBackedHarness = (typeof ADAPTER_BACKED_HARNESSES)[number];

export function isAdapterBackedHarness(
  harness: Harness,
): harness is AdapterBackedHarness {
  return (ADAPTER_BACKED_HARNESSES as readonly Harness[]).includes(harness);
}

/**
 * Skill-delivery mode: how (if at all) the browse CLI's SKILL.md is made
 * available to an external-harness run. Selectable for any external harness,
 * but only the adapter-backed harnesses (bare loops + cursor_sdk) consume
 * it — claude_code/codex keep their own skill provisioning. See
 * packages/evals/README.md#external-harnesses.
 *
 *  - "none": no skill content anywhere. The agent gets the one-line bare
 *    system prompt and must discover the CLI via `--help` on its own.
 *  - "prompt_show": no skill content pre-installed, but the system prompt
 *    instructs the agent to run `browse skills show` first. Requires
 *    a browse CLI release that includes `browse skills show`; on releases
 *    without it the agent cannot discover the skill.
 *  - "injected": the skill content is made available up front (Claude Code's
 *    existing default: SKILL.md installed on disk, loaded via the Skill
 *    tool). Bare loops have no Skill-tool primitive, so for them "injected"
 *    means the SKILL.md text is embedded directly in the system prompt.
 */
export type SkillDeliveryMode = "none" | "prompt_show" | "injected";

export const DEFAULT_SKILL_DELIVERY_MODE: SkillDeliveryMode = "none";

export function parseSkillDeliveryMode(
  value: string | undefined,
): SkillDeliveryMode {
  if (!value) return DEFAULT_SKILL_DELIVERY_MODE;
  if (value === "none" || value === "prompt_show" || value === "injected") {
    return value;
  }
  throw new Error(
    `Unknown skill mode "${value}". Supported: none, prompt_show, injected.`,
  );
}

export function isBenchHarness(value: string): value is Harness {
  return (SUPPORTED_BENCH_HARNESSES as readonly string[]).includes(value);
}

export function isExecutableBenchHarness(value: Harness): boolean {
  return (EXECUTABLE_BENCH_HARNESSES as readonly Harness[]).includes(value);
}

export function parseBenchHarness(value: string | undefined): Harness {
  if (!value) return DEFAULT_BENCH_HARNESS;
  if (isBenchHarness(value)) return value;
  throw new Error(
    `Unknown harness "${value}". Supported: ${SUPPORTED_BENCH_HARNESSES.join(", ")}.`,
  );
}

export type BenchTaskKind =
  | "act"
  | "extract"
  | "observe"
  | "agent"
  | "combination"
  | "suite";

export interface StagehandHarnessConfig {
  harness: "stagehand";
  model: AvailableModel;
  provider?: string;
  environment: "LOCAL" | "BROWSERBASE";
  useApi: boolean;
  agentMode?: AgentToolMode;
  isCUA?: boolean;
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  dataset?: string;
}

export interface ExternalHarnessConfig {
  model: AvailableModel;
  provider?: string;
  environment: "LOCAL" | "BROWSERBASE";
  useApi: boolean;
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  dataset?: string;
  /**
   * Skill-delivery mode for this run. Only consulted by the bare-loop /
   * cursor_sdk harnesses (see externalHarnessToolAdapter.ts) — claude_code
   * and codex keep their existing skill-provisioning behavior unchanged.
   */
  skillMode?: SkillDeliveryMode;
}

export interface ClaudeCodeHarnessConfig extends ExternalHarnessConfig {
  harness: "claude_code";
}

export interface CodexHarnessConfig extends ExternalHarnessConfig {
  harness: "codex";
}

export interface VercelAiSdkHarnessConfig extends ExternalHarnessConfig {
  harness: "vercel_ai_sdk";
}

export interface AnthropicSdkHarnessConfig extends ExternalHarnessConfig {
  harness: "anthropic_sdk";
}

export interface OpenAiAgentsSdkHarnessConfig extends ExternalHarnessConfig {
  harness: "openai_agents_sdk";
}

export interface CursorSdkHarnessConfig extends ExternalHarnessConfig {
  harness: "cursor_sdk";
}

export type BenchHarnessConfig =
  | StagehandHarnessConfig
  | ClaudeCodeHarnessConfig
  | CodexHarnessConfig
  | VercelAiSdkHarnessConfig
  | AnthropicSdkHarnessConfig
  | OpenAiAgentsSdkHarnessConfig
  | CursorSdkHarnessConfig;

export interface BenchMatrixRow {
  harness: Harness;
  task: string;
  category: string;
  taskKind: BenchTaskKind;
  model: AvailableModel;
  provider?: string;
  environment: "LOCAL" | "BROWSERBASE";
  useApi: boolean;
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  trial: number;
  dataset?: string;
  params?: Record<string, unknown>;
  agentMode?: AgentToolMode;
  isCUA?: boolean;
  skillMode?: SkillDeliveryMode;
  config: BenchHarnessConfig;
}
