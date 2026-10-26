/**
 * Per-row context, carried through async calls with AsyncLocalStorage.
 *
 * The runner opens one context around each row execution. Code deep in the
 * harness and target layers — which has no row, progress callback or logger
 * sink in scope — reports what the row is doing through it: the phase it is
 * in (session / agent / verify) and its log lines. Outside a row
 * context every call is a no-op, so library code can call these freely.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** What a running row is doing. `starting` covers setup before a browser session exists. */
export type RowPhase = "starting" | "session" | "agent" | "verify";

export interface RowPhaseDetail {
  /** Browserbase session URL, once the session exists. */
  sessionUrl?: string;
}

/** One log line from a row (an EvalLogger line, or console output inside the row). */
export interface RowLogEntry {
  /** Where it came from: the logger category (harness name, `verifier`, …) or `console`. */
  category: string;
  message: string;
  /** EvalLogger level: 0 error, 1 info, 2 debug. */
  level?: number;
}

export interface RowContext {
  reportPhase(phase: RowPhase, detail?: RowPhaseDetail): void;
  /** Absent when nothing collects this row's logs. */
  log?(entry: RowLogEntry): void;
}

const storage = new AsyncLocalStorage<RowContext>();

export function runInRowContext<T>(context: RowContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function currentRowContext(): RowContext | undefined {
  return storage.getStore();
}

/** Report the current row's phase; a no-op outside a row. */
export function reportRowPhase(phase: RowPhase, detail?: RowPhaseDetail): void {
  storage.getStore()?.reportPhase(phase, detail);
}

/** Send a log line to the current row; returns false outside a row (caller decides). */
export function logToRow(entry: RowLogEntry): boolean {
  const context = storage.getStore();
  if (!context?.log) return false;
  context.log(entry);
  return true;
}
