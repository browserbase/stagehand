let langSmithPromise: Promise<typeof import("langsmith")> | undefined;

export function hasLangSmithApiKey(): boolean {
  return Boolean(process.env.LANGSMITH_API_KEY || process.env.LANGCHAIN_API_KEY);
}

export function langSmithTracingEnabled(): boolean {
  return hasLangSmithApiKey() && process.env.LANGSMITH_TRACING === "true";
}

let warnedUnknownTransport = false;

export function resolveTraceTransport(): "native" | "otel" {
  const value = process.env.EVAL_TRACE_TRANSPORT;
  if (value === "otel") return "otel";
  // Fail loud (once) on a typo'd value so a misconfiguration doesn't silently
  // disable tracing by falling through to the native default.
  if (value && value !== "native" && !warnedUnknownTransport) {
    warnedUnknownTransport = true;
    console.warn(
      `[evals] Unrecognized EVAL_TRACE_TRANSPORT="${value}"; expected "native" or "otel". Falling back to "native".`,
    );
  }
  return "native";
}

export function loadLangSmith(): Promise<typeof import("langsmith")> {
  langSmithPromise ??= import("langsmith");
  return langSmithPromise;
}
