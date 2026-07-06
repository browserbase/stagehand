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
export type SpanLike = Pick<Span, "log">;

export type TracedFn<T> = (span: SpanLike) => Promise<T>;

/** Same shape as Braintrust's StartSpanArgs but `name` is required. */
export type TracedSpanOptions = StartSpanArgs & { name: string };

const NOOP_SPAN: SpanLike = {
  log: () => {},
};

export async function tracedSpan<T>(
  fn: TracedFn<T>,
  options: TracedSpanOptions,
): Promise<T> {
  if (!hasBraintrustApiKey()) {
    return fn(NOOP_SPAN);
  }
  const { traced } = await loadBraintrust();
  return traced(fn, options);
}
