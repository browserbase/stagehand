// Compile-only shim: copied V3 files still call FlowLogger. Replace this with
// the V4 spike's OTEL/structured logging layer before treating it as runtime logging.
export type FlowEvent = {
  eventId?: string;
  eventParentIds?: string[];
};

export type FlowLoggerContext = FlowEvent | null;

type MaybePromise<T> = T | Promise<T>;

export function extractLlmPromptSummary(messages: unknown, options?: unknown): string {
  return JSON.stringify({ messages, options });
}

export class FlowLogger {
  static resolveContext(context?: FlowLoggerContext | null): FlowLoggerContext {
    return context ?? null;
  }

  static withContext<T>(_context: FlowLoggerContext | null | undefined, fn: () => T): T {
    return fn();
  }

  static wrapWithLogging(_options?: unknown): any {
    return () => undefined;
  }

  static async runWithLogging<T>(
    _options: unknown,
    fn: () => MaybePromise<T>,
    ..._args: unknown[]
  ): Promise<T> {
    return await fn();
  }

  static logCdpCallEvent(_context: FlowLoggerContext, _payload: unknown): FlowEvent {
    return {};
  }

  static logCdpResponseEvent(
    _context: FlowLoggerContext,
    _payload: unknown,
    ..._rest: unknown[]
  ): FlowEvent {
    return {};
  }

  static logCdpMessageEvent(
    _context: FlowLoggerContext,
    _payload: unknown,
    ..._rest: unknown[]
  ): FlowEvent {
    return {};
  }

  static logLlmRequest(_payload: unknown): FlowEvent {
    return {};
  }

  static logLlmResponse(_payload: unknown): FlowEvent {
    return {};
  }
}
