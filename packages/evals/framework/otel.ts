import { ProxyTracerProvider, type Tracer } from "@opentelemetry/api";
import {
  BatchSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import { hasLangSmithApiKey, resolveTraceTransport } from "./langsmith.js";

const TRACER_NAME = "stagehand-evals";
const SHUTDOWN_TIMEOUT_MS = 10_000;
const NOOP_TRACER = new ProxyTracerProvider().getTracer(TRACER_NAME);

// Provider state lives on globalThis, NOT in module scope: the CLI bundle
// (esbuild --bundle) inlines this module once per import site, so module-level
// variables would give each importer its own copy — the runner would register
// the provider in one copy while tracedSpan reads NOOP from another, silently
// dropping every span. A Symbol.for-keyed global is shared across all copies.
type TracingState = {
  provider: NodeTracerProvider | null;
  providerPromise: Promise<NodeTracerProvider | null> | null;
};
const STATE_KEY = Symbol.for("stagehand.evals.otel.state");
function state(): TracingState {
  const g = globalThis as { [STATE_KEY]?: TracingState };
  return (g[STATE_KEY] ??= { provider: null, providerPromise: null });
}

/** Test-only: clear shared provider state between vitest module resets. */
export function resetTracingStateForTests(): void {
  const g = globalThis as { [STATE_KEY]?: TracingState };
  delete g[STATE_KEY];
}

export async function buildTracerProvider(options?: {
  braintrustParent?: string;
}): Promise<NodeTracerProvider | null> {
  if (resolveTraceTransport() !== "otel") {
    return null;
  }

  const s = state();
  if (s.provider) {
    return s.provider;
  }

  // The provider is initialized once per process, so the first call's options win.
  const pendingProvider =
    s.providerPromise ??
    (s.providerPromise = initializeTracerProvider(options));

  try {
    return await pendingProvider;
  } finally {
    if (s.providerPromise === pendingProvider) {
      s.providerPromise = null;
    }
  }
}

async function initializeTracerProvider(options?: {
  braintrustParent?: string;
}): Promise<NodeTracerProvider | null> {
  const spanProcessors: SpanProcessor[] = [];

  const braintrustApiKey = process.env.BRAINTRUST_API_KEY;
  if (braintrustApiKey) {
    const { BraintrustSpanProcessor } = await import("@braintrust/otel");
    const braintrustProjectName =
      process.env.CI === "true" ? "stagehand" : "stagehand-dev";
    const parent =
      options?.braintrustParent ??
      process.env.BRAINTRUST_OTEL_PARENT ??
      `project_name:${braintrustProjectName}`;
    const braintrustOtelUrl = process.env.BRAINTRUST_OTEL_URL;
    spanProcessors.push(
      new BraintrustSpanProcessor({
        apiKey: braintrustApiKey,
        parent,
        filterAISpans: false,
        ...(braintrustOtelUrl && {
          apiUrl: braintrustOtelUrl.replace(/otel\/v1\/traces\/?$/, ""),
        }),
      }),
    );
  }

  if (hasLangSmithApiKey() && process.env.LANGSMITH_TRACING === "true") {
    const { LangSmithOTLPTraceExporter } = await import(
      "langsmith/experimental/otel/exporter"
    );
    spanProcessors.push(
      new BatchSpanProcessor(new LangSmithOTLPTraceExporter()),
    );
  }

  if (spanProcessors.length === 0) {
    return null;
  }

  const nextProvider = new NodeTracerProvider({ spanProcessors });
  nextProvider.register();
  state().provider = nextProvider;
  return nextProvider;
}

export function getTracer(): Tracer {
  return state().provider?.getTracer(TRACER_NAME) ?? NOOP_TRACER;
}

export async function shutdownTracing(): Promise<void> {
  const s = state();
  if (resolveTraceTransport() !== "otel" || !s.provider) {
    return;
  }

  const activeProvider = s.provider;
  s.provider = null;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(
        new Error(
          `Timed out shutting down tracing after ${SHUTDOWN_TIMEOUT_MS}ms.`,
        ),
      );
    }, SHUTDOWN_TIMEOUT_MS);
    timeout.unref?.();
  });

  try {
    await Promise.race([
      activeProvider
        .forceFlush()
        .catch(() => {})
        .then(() => activeProvider.shutdown()),
      timeoutPromise,
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
