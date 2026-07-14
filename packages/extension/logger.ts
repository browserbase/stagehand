import { context as otelContext, SpanStatusCode, trace, type Context } from "@opentelemetry/api";
import { z } from "zod/v4";
import { StagehandLogDataSchema, StagehandLogSchema } from "../protocol/schemas.js";
import type {
  LogLine,
  StagehandLog,
  StagehandLogData,
  StagehandLogLevel,
} from "../protocol/types.js";
import type { StagehandTracing } from "./tracing.js";

export type StagehandLogEmitter = (log: StagehandLog) => void;

const StagehandSpanSchema = z.strictObject({
  name: z.string().min(1),
  data: StagehandLogDataSchema,
});

export class StagehandLogger {
  constructor(
    private readonly tracing: Pick<StagehandTracing, "tracer">,
    private readonly emitLog: StagehandLogEmitter,
    private readonly parentContext?: Context,
  ) {}

  withContext(parentContext: Context): StagehandLogger {
    return new StagehandLogger(this.tracing, this.emitLog, parentContext);
  }

  debug(message: string, data: StagehandLogData): void {
    this.write("debug", message, data);
  }

  info(message: string, data: StagehandLogData): void {
    this.write("info", message, data);
  }

  warn(message: string, data: StagehandLogData): void {
    this.write("warn", message, data);
  }

  error(message: string, data: StagehandLogData): void {
    this.write("error", message, data);
  }

  async span<Result>(
    name: string,
    data: StagehandLogData,
    run: (logger: StagehandLogger) => Result | Promise<Result>,
  ): Promise<Result> {
    const input = StagehandSpanSchema.parse({ name, data });
    const parentContext = this.parentContext ?? otelContext.active();
    const span = this.tracing.tracer.startSpan(
      input.name,
      {
        attributes: {
          "stagehand.span.type": "operation",
          "stagehand.span.data": JSON.stringify(input.data),
        },
      },
      parentContext,
    );
    const spanContext = trace.setSpan(parentContext, span);

    try {
      return await otelContext.with(spanContext, () => run(this.withContext(spanContext)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stagehand span failed";
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      if (error instanceof Error) span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  }

  private write(level: StagehandLogLevel, message: string, data: StagehandLogData): void {
    const log = StagehandLogSchema.parse({ level, message, data });
    const span = this.tracing.tracer.startSpan(
      log.message,
      {
        attributes: {
          "stagehand.span.type": "log",
          "stagehand.log.level": log.level,
          "stagehand.log.message": log.message,
          "stagehand.log.data": JSON.stringify(log.data),
        },
      },
      this.parentContext ?? otelContext.active(),
    );

    span.end();
    this.emitLog(log);
  }
}

/**
 * Stagehand V3 Logging
 *
 * The legacy instance-binding functions remain as compatibility no-ops. Browser
 * service workers do not provide AsyncLocalStorage, and an approximation cannot
 * reliably preserve context across awaited work. Callers that need structured
 * instance logging should pass a logger explicitly; other messages use the
 * console fallback below.
 */

export function bindInstanceLogger(_instanceId: string, _logger: (line: LogLine) => void): void {
  // Kept as a compatibility no-op until the logger is replaced.
}

export function unbindInstanceLogger(_instanceId: string): void {
  // Kept as a compatibility no-op until the logger is replaced.
}

export function withInstanceLogContext<T>(_instanceId: string, fn: () => T): T {
  return fn();
}

/**
 * Writes legacy V3 logs to the console.
 */
export function v3Logger(line: LogLine): void {
  const ts = line.timestamp ?? new Date().toISOString();
  const lvl = line.level ?? 1;
  const levelStr = lvl === 0 ? "ERROR" : lvl === 2 ? "DEBUG" : "INFO";
  let output = `[${ts}] ${levelStr}: ${line.message}`;

  if (line.auxiliary) {
    for (const [key, { value, type }] of Object.entries(line.auxiliary)) {
      let formattedValue = value;
      if (type === "object") {
        try {
          formattedValue = JSON.stringify(JSON.parse(value), null, 2)
            .split("\n")
            .map((line, i) => (i === 0 ? line : `    ${line}`))
            .join("\n");
        } catch {
          formattedValue = value;
        }
      }
      output += `\n    ${key}: ${formattedValue}`;
    }
  }

  if (lvl === 0) {
    console.error(output);
  } else if (lvl === 2) {
    (console.debug ?? console.log)(output);
  } else {
    console.log(output);
  }
}
