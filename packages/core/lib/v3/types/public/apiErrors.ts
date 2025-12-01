export class StagehandAPIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class StagehandAPIUnauthorizedError extends StagehandAPIError {
  constructor(message?: string) {
    super(message || "Unauthorized request");
  }
}

export class StagehandHttpError extends StagehandAPIError {
  constructor(message: string) {
    super(message);
  }
}

export class StagehandServerError extends StagehandAPIError {
  constructor(message: string) {
    super(message);
  }
}

export class StagehandResponseBodyError extends StagehandAPIError {
  constructor() {
    super("Response body is null");
  }
}

export class StagehandResponseParseError extends StagehandAPIError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Enhanced error class for Stagehand operation failures.
 * Includes error code and operation name for better debugging.
 */
export class StagehandOperationError extends StagehandAPIError {
  public readonly code?: string;
  public readonly operation?: string;

  constructor(data: { error: string; code?: string; operation?: string }) {
    super(data.error);
    this.code = data.code;
    this.operation = data.operation;
  }

  /**
   * Returns true if the error is a user error (bad input, invalid arguments).
   * User errors can typically be fixed by changing the request.
   */
  isUserError(): boolean {
    return [
      "INVALID_ARGUMENT",
      "MISSING_ARGUMENT",
      "INVALID_MODEL",
      "INVALID_SCHEMA",
      "EXPERIMENTAL_NOT_CONFIGURED",
    ].includes(this.code ?? "");
  }

  /**
   * Returns true if the operation might succeed on retry.
   * These are transient failures that may resolve themselves.
   */
  isRetryable(): boolean {
    return [
      "ACTION_FAILED",
      "TIMEOUT",
      "LLM_ERROR",
      "ELEMENT_NOT_FOUND",
    ].includes(this.code ?? "");
  }
}
