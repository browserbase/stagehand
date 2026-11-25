import { SpanStatusCode } from "@opentelemetry/api";
import type { Span, StartSpanArgs } from "braintrust";
import { resolveTraceTransport } from "./langsmith.js";

let braintrustPromise: Promise<typeof import("braintrust")> | undefined;

export function hasBraintrustApiKey(): boolean {
  return Boolean(process.env.BRAINTRUST_API_KEY);
}

export function loadBraintrust(): Promise<typeof import("braintrust")> {
  braintrustPromise ??= import("braintrust");
  return braintrustPromise;
}

export type BraintrustProjectTier = "core" | "bench";

export function resolveBraintrustProjectName(tier: BraintrustProjectTier = "bench"): string {
  const override = process.env.BRAINTRUST_PROJECT_NAME?.trim();
  if (override) return override;
  const isCI = process.env.CI === "true";
  if (tier === "core") return isCI ? "stagehand-core" : "stagehand-core-dev";
  return isCI ? "stagehand" : "stagehand-dev";
}

type SpanLike = Pick<Span, "log">;

type TracedFn<T> = (span: SpanLike) => Promise<T>;

type TracedSpanOptions = StartSpanArgs & { name: string };

const NOOP_SPAN: SpanLike = {
  log: () => {},
};

export async function tracedSpan<T>(fn: TracedFn<T>, options: TracedSpanOptions): Promise<T> {
  if (resolveTraceTransport() === "otel") {
    const { getTracer, cappedJsonAttr } = await import("./otel.js");
    const input = options.event?.input;
    return getTracer().startActiveSpan(
      options.name,
      {
        attributes: {
          "langsmith.span.kind": options.type === "llm" ? "llm" : "chain",
          ...(input === undefined
            ? {}
            : {
                "input.value": cappedJsonAttr(input),
                "input.mime_type": "application/json",
              }),
        },
      },
      async (otelSpan) => {
        const span: SpanLike = {
          log: (event) => {
            if (event.output !== undefined) {
              otelSpan.setAttributes({
                "output.value": cappedJsonAttr(event.output),
                "output.mime_type": "application/json",
              });
            }
            if (event.metadata !== undefined) {
              otelSpan.setAttribute("langsmith.metadata", cappedJsonAttr(event.metadata));
            }
          },
        };
        try {
          return await fn(span);
        } catch (error) {
          otelSpan.recordException(error instanceof Error ? error : String(error));
          otelSpan.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          otelSpan.end();
        }
      },
    );
  }
  if (!hasBraintrustApiKey()) {
    return fn(NOOP_SPAN);
  }
  const { traced } = await loadBraintrust();
  return traced(fn, options);
}
