export interface RunTelemetryState {
  resultCode?: string;
  httpStatus?: number;
  requestHadHttpResponse?: boolean;
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
