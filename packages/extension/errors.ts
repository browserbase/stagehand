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

export class WebMCPResponseBufferOverflowError extends Error {
  constructor(readonly invocationId: string) {
    super(
      `Unable to safely register WebMCP invocation "${invocationId}" because its early response could not be retained.`,
    );
    this.name = "WebMCPResponseBufferOverflowError";
  }
}
