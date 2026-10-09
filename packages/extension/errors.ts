import type { ProtocolIncompatibilityReason } from "@browserbasehq/stagehand-protocol/protocol-version";

export class TimeoutError extends Error {
  constructor(operation: string, timeout: number) {
    super(`${operation} timed out after ${timeout}ms`);
    this.name = "TimeoutError";
  }
}

export class StagehandProtocolCompatibilityError extends Error {
  constructor(readonly reason: ProtocolIncompatibilityReason) {
    super(`Incompatible Stagehand protocol (${reason})`);
    this.name = "StagehandProtocolCompatibilityError";
  }
}

export class DuplicatePageEventSubscriptionError extends Error {
  constructor() {
    super("A page event subscription with this identifier already exists");
    this.name = "DuplicatePageEventSubscriptionError";
  }
}

export class ShadowRootEvaluationError extends Error {
  constructor() {
    super("Shadow-root evaluation failed");
    this.name = "ShadowRootEvaluationError";
  }
}

export class ShadowRootEvaluationUnavailableError extends Error {
  constructor() {
    super("Shadow-root evaluation is unavailable");
    this.name = "ShadowRootEvaluationUnavailableError";
  }
}

export class BrowserSessionUnavailableError extends Error {
  readonly code = "STAGEHAND_BROWSER_SESSION_UNAVAILABLE";

  constructor(timeoutMs: number) {
    super(
      `STAGEHAND_BROWSER_SESSION_UNAVAILABLE: The Stagehand browser connection is being re-established; it did not become available within ${timeoutMs}ms`,
    );
    this.name = "BrowserSessionUnavailableError";
  }
}
