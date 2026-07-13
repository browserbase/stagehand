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

let provider: NodeTracerProvider | null = null;
let providerPromise: Promise<NodeTracerProvider | null> | null = null;

export async function buildTracerProvider(options?: {
  braintrustParent?: string;
}): Promise<NodeTracerProvider | null> {
  if (resolveTraceTransport() !== "otel") {
    return null;
  }

  if (provider) {
    return provider;
  }

  // The provider is initialized once per process, so the first call's options win.
  const pendingProvider =
    providerPromise ?? (providerPromise = initializeTracerProvider(options));

  try {
    return await pendingProvider;
  } finally {
    if (providerPromise === pendingProvider) {
      providerPromise = null;
    }
  }
}

async function initializeTracerProvider(options?: {
  braintrustParent?: string;
}): Promise<NodeTracerProvider | null> {
  const spanProcessors: SpanProcessor[] = [];

  const braintrustApiKey = process.env.BRAINTRUST_API_KEY;
  if (braintrustApiKey) {
    const { OTLPTraceExporter } = await import(
      "@opentelemetry/exporter-trace-otlp-proto"
    );
    const braintrustProjectName =
      process.env.CI === "true" ? "stagehand" : "stagehand-dev";
    const parent =
      options?.braintrustParent ??
      process.env.BRAINTRUST_OTEL_PARENT ??
      `project_name:${braintrustProjectName}`;
    spanProcessors.push(
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url:
            process.env.BRAINTRUST_OTEL_URL ??
            "https://api.braintrust.dev/otel/v1/traces",
          headers: {
            Authorization: `Bearer ${braintrustApiKey}`,
            "x-bt-parent": parent,
          },
        }),
      ),
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
  provider = nextProvider;
  return nextProvider;
}

export function getTracer(): Tracer {
  return provider?.getTracer(TRACER_NAME) ?? NOOP_TRACER;
}

export async function shutdownTracing(): Promise<void> {
  if (resolveTraceTransport() !== "otel" || !provider) {
    return;
  }

  const activeProvider = provider;
  provider = null;

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
