import type { AvailableModel } from "stagehand-v3";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";

export type Harness = string;

export const DEFAULT_BENCH_HARNESS: Harness = "stagehand";

export type BenchTaskKind = "act" | "extract" | "observe" | "agent" | "combination" | "suite";

export interface StagehandHarnessConfig {
  harness: "stagehand";
  model: AvailableModel;
  provider?: string;
  environment: "LOCAL" | "BROWSERBASE";
  useApi: boolean;
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  dataset?: string;
}

export interface ExternalHarnessConfig {
  harness: string;
  model: AvailableModel;
  provider?: string;
  environment: "LOCAL" | "BROWSERBASE";
  useApi: boolean;
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  dataset?: string;
}

export type BenchHarnessConfig = StagehandHarnessConfig | ExternalHarnessConfig;

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
  config: BenchHarnessConfig;
}
