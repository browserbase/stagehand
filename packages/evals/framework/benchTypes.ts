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
] as const satisfies readonly Harness[];

/**
 * The "bare loop" harnesses: a single generic tool-calling loop with no
 * agentic scaffolding beyond what the model provider's SDK gives for free.
 * Used to gate bare-loop-only behavior (system-prompt policy, skill-delivery
 * arms, step-cap defaults) without repeating the harness list everywhere.
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
 * Skill-delivery mode: how (if at all) the browse CLI's SKILL.md is made
 * available to an external-harness run. Orthogonal to `Harness` — it's the
 * A/B/C experiment arm crossed with the harness-richness spectrum. See
 * packages/evals/docs/external-harnesses.md for the full design rationale.
 *
 *  - "none": no skill content anywhere. The agent gets the one-line bare
 *    system prompt and must discover the CLI via `--help` on its own.
 *  - "prompt_show": no skill content pre-installed, but the system prompt
 *    instructs the agent to run `browse skills show browser` first. Requires
 *    a browse CLI release carrying #2335 (unreleased as of this writing) —
 *    callers should treat this arm as not-yet-usable until that ships.
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
   * Skill-delivery arm for this run. Only consulted by the bare-loop /
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
