export class RPCResponseTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number) {
    super(`RPC response timed out: ${method} after ${timeoutMs}ms`, {
      cause: { method, timeoutMs },
    });
    this.name = "RPCResponseTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}
