/**
 * The run currently drawing a live board, if any.
 *
 * Key handlers live outside `runCommand` (the REPL's keypress listener, the
 * argv-mode listener in cli.ts). They reach the board through this registry
 * instead of printing over it: an animated board redraws in place, so a stray
 * console.log mid-run leaves a broken frame behind.
 */

import type { StopMode } from "./progress.js";

export interface LiveRun {
  /** Show that the run is stopping (cooperative) or being stopped now (aggressive). */
  setStopping(mode: StopMode): void;
  /** A key pressed during the run; returns true when the run handled it. */
  onKey?(name: string): boolean;
}

let active: LiveRun | undefined;

export function setActiveRun(run: LiveRun | undefined): void {
  active = run;
}

export function getActiveRun(): LiveRun | undefined {
  return active;
}
