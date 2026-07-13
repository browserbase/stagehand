/**
 * Braintrust tracing helper.
 *
 * Thin wrapper around `braintrust.traced` that lets callers carry a span into
 * the work and `span.log({ output, scores, metrics, metadata })` along the
 * way. Outside an active Braintrust experiment, `traced` no-ops and returns
 * the callback's value unchanged, so this is safe to call from offline tools
 * (e.g., `bench verify`).
 */
import type { Span, StartSpanArgs } from "braintrust";
import type {
  Attributes,
  AttributeValue,
  Span as OtelSpan,
} from "@opentelemetry/api";
import { SpanStatusCode } from "@opentelemetry/api";

import { resolveTraceTransport } from "./langsmith.js";

let braintrustPromise: Promise<typeof import("braintrust")> | undefined;

export function hasBraintrustApiKey(): boolean {
  return Boolean(process.env.BRAINTRUST_API_KEY);
}

export function loadBraintrust(): Promise<typeof import("braintrust")> {
  braintrustPromise ??= import("braintrust");
  return braintrustPromise;
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

function toAttributeValue(value: unknown): AttributeValue | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toAttributes(
  values: Record<string, unknown>,
  prefix?: string,
): Attributes {
  const attributes: Attributes = {};
  for (const [key, value] of Object.entries(values)) {
    const attribute = toAttributeValue(value);
    if (attribute !== undefined) {
      attributes[prefix ? `${prefix}.${key}` : key] = attribute;
    }
  }
  return attributes;
}

function outputAttributes(output: unknown): Attributes {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    return toAttributes(output as Record<string, unknown>);
  }
  const value = toAttributeValue(output);
  return value === undefined ? {} : { output: value };
}

function setSpanAttributes(span: OtelSpan, attributes: Attributes): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      span.setAttribute(key, value);
    }
  }
}

export async function tracedSpan<T>(
  fn: TracedFn<T>,
  options: TracedSpanOptions,
): Promise<T> {
  if (resolveTraceTransport() === "otel") {
    const { getTracer } = await import("./otel.js");
    return getTracer().startActiveSpan(options.name, async (span) => {
      if (options.type !== undefined) {
        span.setAttribute("type", options.type);
      }
      const input = options.event?.input;
      if (input && typeof input === "object" && !Array.isArray(input)) {
        setSpanAttributes(
          span,
          toAttributes(input as Record<string, unknown>, "input"),
        );
      } else if (input !== undefined) {
        const value = toAttributeValue(input);
        if (value !== undefined) {
          span.setAttribute("input", value);
        }
      }

      const adapter: SpanLike = {
        log: ({ output, scores, metrics, metadata, ...fields }) => {
          if (metadata) {
            setSpanAttributes(span, toAttributes(metadata, "metadata"));
          }
          if (metrics) {
            setSpanAttributes(span, toAttributes(metrics, "metrics"));
          }
          if (scores) {
            const attributes = toAttributes(scores, "scores");
            span.addEvent("scores", attributes);
          }
          setSpanAttributes(span, toAttributes(fields));
          if (output !== undefined) {
            span.addEvent("output", outputAttributes(output));
          }
        },
      };
      try {
        return await fn(adapter);
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        span.recordException(error instanceof Error ? error : String(error));
        throw error;
      } finally {
        span.end();
      }
    });
  }
  if (!hasBraintrustApiKey()) {
    return fn(NOOP_SPAN);
  }
  const { traced } = await loadBraintrust();
  return traced(fn, options);
}
