import type { ProtocolIncompatibilityReason } from "@browserbasehq/stagehand-protocol/protocol-version";

export class DecisionModelNotConfiguredError extends Error {
  constructor() {
    super(
      "A client decision callback must be configured with decisionModel.choose (Python: decision_model['choose'])",
    );
    this.name = "DecisionModelNotConfiguredError";
  }
}

export class PromptLocatorRefusedError extends Error {
  constructor() {
    super("The decision callback refused to select an element for the prompt locator");
    this.name = "PromptLocatorRefusedError";
  }
}

export class PromptLocatorNoMatchError extends Error {
  constructor() {
    super("Could not find an element matching the prompt locator");
    this.name = "PromptLocatorNoMatchError";
  }
}

export class InvalidPromptLocatorSelectionError extends Error {
  constructor() {
    super(
      "The decision callback must select an ID with an exact target in this request's candidates",
    );
    this.name = "InvalidPromptLocatorSelectionError";
  }
}

export class UnsupportedPromptLocatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedPromptLocatorError";
  }
}

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
