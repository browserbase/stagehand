import type { ProtocolIncompatibilityReason } from "@browserbasehq/stagehand-protocol/protocol-version";

export class TimeoutError extends Error {
  constructor(operation: string, timeout: number) {
    super(`${operation} timed out after ${timeout}ms`);
    this.name = "TimeoutError";
  }
}

export class CaptureRecoveryError extends Error {
  constructor(cause: TimeoutError) {
    super(`A previous capture is still recovering: ${cause.message}`, { cause });
    this.name = "CaptureRecoveryError";
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
