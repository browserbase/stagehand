import type { CDPSessionLike } from "../../../lib/v3/understudy/cdp.js";

type Handler = (params?: Record<string, unknown>) => Promise<unknown> | unknown;
type EventHandler = (params?: Record<string, unknown>) => void;

export class MockCDPSession implements CDPSessionLike {
  public readonly id: string;
  public readonly calls: Array<{
    method: string;
    params?: Record<string, unknown>;
  }> = [];
  private readonly listeners = new Map<string, Set<EventHandler>>();

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

  on<P = unknown>(event: string, handler: (params: P) => void): void {
    const handlers = this.listeners.get(event) ?? new Set<EventHandler>();
    handlers.add(handler as EventHandler);
    this.listeners.set(event, handlers);
  }

  off<P = unknown>(event: string, handler: (params: P) => void): void {
    this.listeners.get(event)?.delete(handler as EventHandler);
  }

  emit(event: string, params: Record<string, unknown> = {}): void {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(params);
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  async close(): Promise<void> {}

  callsFor(method: string): Array<{ params?: Record<string, unknown> }> {
    return this.calls
      .filter((call) => call.method === method)
      .map(({ params }) => ({ params }));
  }
}
