import type { DriverCommandName } from "../driver/commands/types.js";

export interface MacroStep {
  command: DriverCommandName;
  params?: unknown;
}

export interface BrowseMacro {
  createdAt: string;
  name: string;
  steps: MacroStep[];
}

export interface MacroRecordingState {
  name: string;
  startedAt: string;
  steps: MacroStep[];
}
