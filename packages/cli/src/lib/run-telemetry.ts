export interface RunTelemetryState {
  resultCode?: string;
  httpStatus?: number;
  requestHadHttpResponse?: boolean;
  skillId?: string;
  /** Resolved driver session kind, e.g. "managed-local" | "remote" | "cdp". */
  sessionMode?: string;
  /** For managed-local sessions, whether the resolved window mode was headless. */
  headless?: boolean;
}

let currentRunTelemetry: RunTelemetryState = {};

export function resetRunTelemetry(): void {
  currentRunTelemetry = {};
}

export function getRunTelemetry(): RunTelemetryState {
  return currentRunTelemetry;
}

export function setRunTelemetryCompletion(
  completion: Partial<RunTelemetryState>,
): void {
  currentRunTelemetry = {
    ...currentRunTelemetry,
    ...completion,
  };
}
