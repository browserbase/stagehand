import { AsyncLocalStorage } from "node:async_hooks";

export type RowPhase = "starting" | "session" | "agent" | "verify";

export interface RowPhaseDetail {
  sessionUrl?: string;
}

export interface RowLogEntry {
  category: string;
  message: string;
  level?: number;
}

export interface RowContext {
  reportPhase(phase: RowPhase, detail?: RowPhaseDetail): void;
  log?(entry: RowLogEntry): void;
}

const storage = new AsyncLocalStorage<RowContext>();

export function runInRowContext<T>(context: RowContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function currentRowContext(): RowContext | undefined {
  return storage.getStore();
}

export function reportRowPhase(phase: RowPhase, detail?: RowPhaseDetail): void {
  storage.getStore()?.reportPhase(phase, detail);
}

export function logToRow(entry: RowLogEntry): boolean {
  const context = storage.getStore();
  if (!context?.log) return false;
  context.log(entry);
  return true;
}
