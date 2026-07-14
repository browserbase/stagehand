import { context as otelContext, SpanStatusCode, trace, type Context } from "@opentelemetry/api";
import { z } from "zod/v4";
import { StagehandLogDataSchema, StagehandLogSchema } from "../protocol/schemas.js";
import type { StagehandLog, StagehandLogData, StagehandLogLevel } from "../protocol/types.js";
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
