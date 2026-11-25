import type { StopMode } from "./progress.js";

export interface LiveRun {
  setStopping(mode: StopMode): void;
  onKey?(name: string): boolean;
}

let active: LiveRun | undefined;

export function setActiveRun(run: LiveRun | undefined): void {
  active = run;
}

export function getActiveRun(): LiveRun | undefined {
  return active;
}
