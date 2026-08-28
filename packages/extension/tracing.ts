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
import type { ImplementationInfo, TelemetryConfig } from "../protocol/types.js";
import extensionPackageJson from "./package.json" with { type: "json" };

const STAGEHAND_TRACER_NAME = "@browserbasehq/stagehand";

export const StagehandTracingRuntimeOptionsSchema = z.strictObject({
  serviceName: z.string().min(1).default("stagehand-service-worker"),
  serviceVersion: z.string().min(1).default(extensionPackageJson.version),
  clientName: z.string().min(1).optional(),
  clientVersion: z.string().min(1).optional(),
  registerGlobals: z.boolean().default(true),
});

export type StagehandTracingRuntimeOptions = z.input<typeof StagehandTracingRuntimeOptionsSchema>;

type StagehandTracingRuntime = {
  readonly tracer: Tracer;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
};

export type StagehandTracing = StagehandTracingRuntime & {
  configure(telemetry: TelemetryConfig, clientInfo: ImplementationInfo): Promise<void>;
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
        ...(options.clientName ? { "stagehand.client.name": options.clientName } : {}),
        ...(options.clientVersion ? { "stagehand.client.version": options.clientVersion } : {}),
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
  let globalsRegistered = false;
  let lifecycleTail = Promise.resolve();
  let activeTelemetry: TelemetryConfig | undefined;
  let activeClientInfo: ImplementationInfo | undefined;

  function enqueueLifecycle(run: () => Promise<void>): Promise<void> {
    const result = lifecycleTail.then(run, run);
    lifecycleTail = result.catch(() => undefined);
    return result;
  }

  return {
    get tracer() {
      return runtime?.tracer ?? pendingTracer;
    },
    configure(telemetry, clientInfo) {
      return enqueueLifecycle(async () => {
        if (shutDown) return;
        if (runtime && telemetry === activeTelemetry && clientInfo === activeClientInfo) {
          return;
        }

        const previousRuntime = runtime;
        runtime = undefined;
        await previousRuntime?.shutdown();

        const registerGlobals = options.registerGlobals !== false && !globalsRegistered;
        runtime = createStagehandTracingRuntime(
          {
            ...options,
            clientName: clientInfo.name,
            clientVersion: clientInfo.version,
            registerGlobals,
          },
          {
            spanProcessors: [
              ...dependencies.spanProcessors,
              createOtlpSpanProcessor(telemetry.traces),
            ],
          },
        );
        activeTelemetry = telemetry;
        activeClientInfo = clientInfo;
        globalsRegistered ||= registerGlobals;
      });
    },
    forceFlush: () => enqueueLifecycle(() => runtime?.forceFlush() ?? Promise.resolve()),
    shutdown: () => {
      shutDown = true;
      return enqueueLifecycle(async () => {
        const activeRuntime = runtime;
        runtime = undefined;
        activeTelemetry = undefined;
        activeClientInfo = undefined;
        await activeRuntime?.shutdown();
      });
    },
  };
}

function createOtlpSpanProcessor(traces: TelemetryConfig["traces"]): BatchSpanProcessor {
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
