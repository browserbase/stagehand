import type { AgentToolMode, AvailableModel } from "@browserbasehq/stagehand";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";

export type Harness = "stagehand" | "claude_code" | "codex";

export const DEFAULT_BENCH_HARNESS: Harness = "stagehand";

export const SUPPORTED_BENCH_HARNESSES = [
  "stagehand",
  "claude_code",
  "codex",
] as const satisfies readonly Harness[];

export const EXECUTABLE_BENCH_HARNESSES = [
  "stagehand",
  "claude_code",
  "codex",
] as const satisfies readonly Harness[];

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
}

export interface ClaudeCodeHarnessConfig extends ExternalHarnessConfig {
  harness: "claude_code";
}

export interface CodexHarnessConfig extends ExternalHarnessConfig {
  harness: "codex";
}

export type BenchHarnessConfig =
  | StagehandHarnessConfig
  | ClaudeCodeHarnessConfig
  | CodexHarnessConfig;

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
  config: BenchHarnessConfig;
}
