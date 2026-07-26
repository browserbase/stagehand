export class TimeoutError extends Error {
  constructor(operation: string, timeout: number) {
    super(`${operation} timed out after ${timeout}ms`);
    this.name = "TimeoutError";
  }
}

export class PageNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageNotFoundError";
  }
}
