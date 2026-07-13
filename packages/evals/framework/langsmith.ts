let langSmithPromise: Promise<typeof import("langsmith")> | undefined;

export function hasLangSmithApiKey(): boolean {
  return Boolean(process.env.LANGSMITH_API_KEY);
}

export const langSmithTracingEnabled =
  hasLangSmithApiKey() && process.env.LANGSMITH_TRACING === "true";

export function resolveTraceTransport(): "native" | "otel" {
  return process.env.EVAL_TRACE_TRANSPORT === "otel" ? "otel" : "native";
}

export function loadLangSmith(): Promise<typeof import("langsmith")> {
  langSmithPromise ??= import("langsmith");
  return langSmithPromise;
}

export function assertLangSmithReady(): void {
  if (!hasLangSmithApiKey()) {
    throw new Error(
      "LangSmith tracing was selected, but LANGSMITH_API_KEY is not set.",
    );
  }
  if (process.env.LANGSMITH_TRACING !== "true") {
    throw new Error(
      'LangSmith tracing was selected, but LANGSMITH_TRACING is not set to "true".',
    );
  }
}
