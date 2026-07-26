export class TimeoutError extends Error {
  constructor(operation: string, timeout: number) {
    super(`${operation} timed out after ${timeout}ms`);
    this.name = "TimeoutError";
  }
}

export class CachedActionRebindError extends Error {
  constructor(readonly kind: "selector" | "argument" = "selector") {
    super(
      kind === "argument"
        ? "Cached action argument no longer resolves in the current page snapshot"
        : "Cached action no longer resolves in the current page snapshot",
    );
    this.name = "CachedActionRebindError";
  }
}
