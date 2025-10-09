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
