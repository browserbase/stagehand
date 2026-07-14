import { trace, type Tracer } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  WebTracerProvider,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-web";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { z } from "zod/v4";
import type { StagehandTelemetryOptions } from "../protocol/types.js";
import { STAGEHAND_VERSION } from "./version.js";

const STAGEHAND_TRACER_NAME = "@browserbasehq/stagehand";

export const StagehandTracingRuntimeOptionsSchema = z.strictObject({
  serviceName: z.string().min(1).default("stagehand-service-worker"),
  serviceVersion: z.string().min(1).default(STAGEHAND_VERSION),
  registerGlobals: z.boolean().default(true),
});

export type StagehandTracingRuntimeOptions = z.input<typeof StagehandTracingRuntimeOptionsSchema>;

type StagehandTracingRuntime = {
  readonly tracer: Tracer;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
};

export type StagehandTracing = StagehandTracingRuntime & {
  configure(telemetry: StagehandTelemetryOptions): void;
};

type StagehandTracingRuntimeDependencies = {
  spanProcessors: readonly SpanProcessor[];
};

const DEFAULT_TRACING_RUNTIME_DEPENDENCIES = {
  spanProcessors: [],
} satisfies StagehandTracingRuntimeDependencies;

export function createStagehandTracingRuntime(
  input: StagehandTracingRuntimeOptions = {},
  dependencies: StagehandTracingRuntimeDependencies = DEFAULT_TRACING_RUNTIME_DEPENDENCIES,
): StagehandTracingRuntime {
  const options = StagehandTracingRuntimeOptionsSchema.parse(input);

  const provider = new WebTracerProvider({
    resource: defaultResource().merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: options.serviceName,
        [ATTR_SERVICE_NAMESPACE]: "browserbase",
        [ATTR_SERVICE_VERSION]: options.serviceVersion,
      }),
    ),
    sampler: new AlwaysOnSampler(),
    spanProcessors: [...dependencies.spanProcessors],
  });

  if (options.registerGlobals) {
    provider.register({ propagator: new W3CTraceContextPropagator() });
  }

  const tracer = provider.getTracer(STAGEHAND_TRACER_NAME, options.serviceVersion);
  let shutdownPromise: Promise<void> | undefined;

  return {
    tracer,
    forceFlush: () => (shutdownPromise ? Promise.resolve() : provider.forceFlush()),
    shutdown: () => {
      // Telemetry delivery is best effort and must not fail Stagehand shutdown.
      shutdownPromise ??= provider.shutdown().catch(() => undefined);
      return shutdownPromise;
    },
  };
}

export function createStagehandTracing(
  options: StagehandTracingRuntimeOptions = {},
  dependencies: StagehandTracingRuntimeDependencies = DEFAULT_TRACING_RUNTIME_DEPENDENCIES,
): StagehandTracing {
  const pendingTracer = trace.getTracer(STAGEHAND_TRACER_NAME);
  let runtime: StagehandTracingRuntime | undefined;
  let shutDown = false;

  return {
    get tracer() {
      return runtime?.tracer ?? pendingTracer;
    },
    configure(telemetry) {
      if (runtime || shutDown) return;
      runtime = createStagehandTracingRuntime(options, {
        spanProcessors: [...dependencies.spanProcessors, createOtlpSpanProcessor(telemetry.traces)],
      });
    },
    forceFlush: () => runtime?.forceFlush() ?? Promise.resolve(),
    shutdown: () => {
      shutDown = true;
      return runtime?.shutdown() ?? Promise.resolve();
    },
  };
}

function createOtlpSpanProcessor(traces: StagehandTelemetryOptions["traces"]): BatchSpanProcessor {
  // TODO: Decide whether a user OTLP endpoint should disable future Browserbase export for ZDR
  // sessions. Until then, span processors intentionally fan out to every destination.
  return new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: traces.endpoint,
      headers: traces.headers,
      timeoutMillis: 5_000,
      concurrencyLimit: 2,
    }),
    {
      scheduledDelayMillis: 1_000,
      exportTimeoutMillis: 5_000,
      maxQueueSize: 512,
      maxExportBatchSize: 128,
      disableAutoFlushOnDocumentHide: true,
    },
  );
}
