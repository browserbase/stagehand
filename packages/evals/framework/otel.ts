import { SpanStatusCode, trace, type ProxyTracerProvider, type Tracer } from "@opentelemetry/api";
import {
  BatchSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
// verify after install: @opentelemetry/sdk-trace-node exports NodeTracerProvider.
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import { langSmithTracingEnabled, resolveTraceTransport } from "./langsmith.js";

const TRACER_NAME = "stagehand-evals";
const SHUTDOWN_TIMEOUT_MS = 10_000;
const MAX_SPAN_ATTR_BYTES = 200_000;

let currentProvider: NodeTracerProvider | ProxyTracerProvider | null = null;
let providerPromise: Promise<void> | null = null;
let providerRegistered = false;

export async function buildTracerProvider({
  braintrustParent,
}: {
  braintrustParent?: string;
}): Promise<void> {
  // Self-gate: never register a global provider off the otel transport, so the
  // native/Braintrust path is untouched even if a caller invokes this directly.
  if (resolveTraceTransport() !== "otel") return;
  if (providerRegistered || currentProvider) return;
  if (providerPromise) return providerPromise;

  providerPromise = initializeTracerProvider(braintrustParent);
  try {
    await providerPromise;
  } finally {
    providerPromise = null;
  }
}

async function initializeTracerProvider(braintrustParent?: string): Promise<void> {
  const spanProcessors: SpanProcessor[] = [];
  const braintrustApiKey = process.env.BRAINTRUST_API_KEY;

  if (braintrustApiKey) {
    // verify after install: @braintrust/otel exports BraintrustSpanProcessor.
    const { BraintrustSpanProcessor } = await import("@braintrust/otel");
    const braintrustProjectName = process.env.CI === "true" ? "stagehand" : "stagehand-dev";
    const parent =
      braintrustParent ??
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

  if (langSmithTracingEnabled()) {
    // verify after install: this subpath exports LangSmithOTLPTraceExporter.
    const { LangSmithOTLPTraceExporter } = await import("langsmith/experimental/otel/exporter");
    // LangSmith's exporter inherits the full OTLP exporter implementation at
    // runtime, but its declaration omits the inherited shutdown() method when
    // the optional OTLP peer's types are not installed directly.
    const exporter = new LangSmithOTLPTraceExporter() as unknown as SpanExporter;
    spanProcessors.push(new BatchSpanProcessor(exporter));
  }

  const provider = new NodeTracerProvider({ spanProcessors });
  provider.register();
  currentProvider = provider;
  providerRegistered = true;
}

export function getTracer(): Tracer {
  return currentProvider?.getTracer(TRACER_NAME) ?? trace.getTracer(TRACER_NAME);
}

export function jsonAttr(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserializable]";
  }
}

/** JSON attribute value, replaced with a truncation marker if oversized. */
export function cappedJsonAttr(value: unknown): string {
  const serialized = jsonAttr(value);
  if (Buffer.byteLength(serialized, "utf8") <= MAX_SPAN_ATTR_BYTES) return serialized;
  return jsonAttr({
    _truncated: `attribute exceeded ${MAX_SPAN_ATTR_BYTES} UTF-8 bytes; see the task-root span payload / .trajectories for the full record`,
  });
}

export interface HarnessAgentSpanInfo {
  /** Harness name, e.g. "claude_code" | "codex". */
  harness: string;
  model: string;
  task: string;
  instruction?: string;
}

/**
 * Wrap an external-harness (claude_code / codex) agent run in an OTEL span so
 * it appears as an agent node under the eval's task-root span in LangSmith /
 * Braintrust — parity with the `stagehand` harness, whose native RPC spans are
 * captured directly via the global tracer. These harnesses drive their own
 * SDKs (claude-agent-sdk / codex-sdk), which do not emit OTEL, so this span +
 * the trajectory payload on the task-root span are the trace's agent record.
 *
 * No-op (runs `fn` directly, creates no span) unless the OTEL transport is
 * active, so the native/Braintrust path stays byte-identical.
 */
export async function withHarnessAgentSpan<T extends { _success?: boolean }>(
  info: HarnessAgentSpanInfo,
  fn: () => Promise<T>,
): Promise<T> {
  if (resolveTraceTransport() !== "otel") return fn();

  return getTracer().startActiveSpan(
    `agent.${info.harness}`,
    {
      attributes: {
        "langsmith.span.kind": "chain",
        "langsmith.metadata": jsonAttr({
          harness: info.harness,
          model: info.model,
          task: info.task,
        }),
        "input.value": cappedJsonAttr({
          instruction: info.instruction,
          model: info.model,
          task: info.task,
        }),
        "input.mime_type": "application/json",
      },
    },
    async (span) => {
      try {
        const result = await fn();
        span.setAttributes({
          "output.value": cappedJsonAttr(result),
          "output.mime_type": "application/json",
        });
        return result;
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export async function shutdownTracing(): Promise<void> {
  const provider = currentProvider;
  currentProvider = null;
  providerPromise = null;
  // Clear the init guard so a later runEvals in the same process can register a
  // fresh provider (otherwise buildTracerProvider() short-circuits and drops spans).
  providerRegistered = false;

  if (!(provider instanceof NodeTracerProvider)) return;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`Tracing shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms.`)),
      SHUTDOWN_TIMEOUT_MS,
    );
    timeout.unref?.();
  });

  try {
    await Promise.race([
      provider
        .forceFlush()
        .catch(() => {})
        .then(() => provider.shutdown()),
      timeoutPromise,
    ]);
  } catch {
    // Tracing teardown must never mask an eval result.
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function resetTracingStateForTests(): void {
  currentProvider = null;
  providerPromise = null;
  providerRegistered = false;
}
