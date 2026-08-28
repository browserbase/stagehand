/**
 * Braintrust tracing helper.
 *
 * Thin wrapper around `braintrust.traced` that lets callers carry a span into
 * the work and `span.log({ output, scores, metrics, metadata })` along the
 * way. Outside an active Braintrust experiment, `traced` no-ops and returns
 * the callback's value unchanged, so this is safe to call from offline tools
 * (e.g., `bench verify`).
 */
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

/**
 * Braintrust project a run logs to. `BRAINTRUST_PROJECT_NAME` overrides the
 * default so users can route runs to their own project; otherwise the
 * tier × CI matrix picks stagehand[-core][-dev]. Single source for both the
 * native `Eval()` path and the OTEL `project_name:` parent so the two
 * transports never disagree about where a run lands.
 */
export function resolveBraintrustProjectName(tier: BraintrustProjectTier = "bench"): string {
  const override = process.env.BRAINTRUST_PROJECT_NAME?.trim();
  if (override) return override;
  const isCI = process.env.CI === "true";
  if (tier === "core") return isCI ? "stagehand-core" : "stagehand-core-dev";
  return isCI ? "stagehand" : "stagehand-dev";
}

/**
 * The only Span surface traced callbacks may use. Deliberately narrower than
 * Braintrust's `Span` so the no-key fallback below can satisfy it without
 * lying about unimplemented methods.
 */
type SpanLike = Pick<Span, "log">;

type TracedFn<T> = (span: SpanLike) => Promise<T>;

/** Same shape as Braintrust's StartSpanArgs but `name` is required. */
type TracedSpanOptions = StartSpanArgs & { name: string };

const NOOP_SPAN: SpanLike = {
  log: () => {},
};

export async function tracedSpan<T>(fn: TracedFn<T>, options: TracedSpanOptions): Promise<T> {
  if (resolveTraceTransport() === "otel") {
    // cappedJsonAttr keeps oversized attrs under the exporter limit; shared with
    // otel.ts so there's a single serialization/cap path.
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
