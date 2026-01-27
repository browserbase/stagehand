import type { CDPSessionLike } from "../../lib/v3/understudy/cdp";

type Handler = (params?: Record<string, unknown>) => Promise<unknown> | unknown;

export class MockCDPSession implements CDPSessionLike {
  public readonly id: string;
  public readonly calls: Array<{
    method: string;
    params?: Record<string, unknown>;
  }> = [];

  constructor(
    private readonly handlers: Record<string, Handler> = {},
    sessionId = "mock-session",
  ) {
    this.id = sessionId;
  }

  async send<R = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<R> {
    this.calls.push({ method, params });
    const handler = this.handlers[method];
    if (!handler) return {} as R;
    return (await handler(params)) as R;
  }

  on(): void {}
  off(): void {}
  async close(): Promise<void> {}

  callsFor(method: string): Array<{ params?: Record<string, unknown> }> {
    return this.calls
      .filter((call) => call.method === method)
      .map(({ params }) => ({ params }));
  }
}
