import type { ProtocolIncompatibilityReason } from "../protocol/protocol-version.js";

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

export class BrowserSessionUnavailableError extends Error {
  readonly code = "STAGEHAND_BROWSER_SESSION_UNAVAILABLE";

  constructor(timeoutMs: number) {
    super(
      `STAGEHAND_BROWSER_SESSION_UNAVAILABLE: The Stagehand browser connection is being re-established; it did not become available within ${timeoutMs}ms`,
    );
    this.name = "BrowserSessionUnavailableError";
  }
}
