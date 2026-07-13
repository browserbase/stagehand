import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const braintrustExporter = vi.fn(function () {
    return {
      export: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
  });
  const langSmithExporter = vi.fn(function () {
    return {
      export: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
  });
  const nodeTracerProvider = vi.fn(function (options: unknown) {
    return {
      forceFlush: vi.fn().mockResolvedValue(undefined),
      getTracer: vi.fn(),
      options,
      register: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
  });

  return {
    braintrustExporter,
    langSmithExporter,
    nodeTracerProvider,
  };
});

vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => ({
  OTLPTraceExporter: mocks.braintrustExporter,
}));

vi.mock("langsmith/experimental/otel/exporter", () => ({
  LangSmithOTLPTraceExporter: mocks.langSmithExporter,
}));

vi.mock("@opentelemetry/sdk-trace-node", () => ({
  NodeTracerProvider: mocks.nodeTracerProvider,
}));

const originalEnv = { ...process.env };

function constructedSpanProcessors(): unknown[] {
  const options = mocks.nodeTracerProvider.mock.calls[0]?.[0] as
    | { spanProcessors: unknown[] }
    | undefined;
  return options?.spanProcessors ?? [];
}

describe("buildTracerProvider", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.BRAINTRUST_API_KEY;
    delete process.env.BRAINTRUST_OTEL_PARENT;
    delete process.env.BRAINTRUST_OTEL_URL;
    delete process.env.CI;
    delete process.env.EVAL_TRACE_TRANSPORT;
    delete process.env.LANGSMITH_API_KEY;
    delete process.env.LANGSMITH_TRACING;
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("does not construct a provider in native mode", async () => {
    const { buildTracerProvider } = await import("../../framework/otel.js");

    await expect(buildTracerProvider()).resolves.toBeNull();
    expect(mocks.nodeTracerProvider).not.toHaveBeenCalled();
  });

  it("constructs a provider with both backend processors", async () => {
    process.env.EVAL_TRACE_TRANSPORT = "otel";
    process.env.BRAINTRUST_API_KEY = "braintrust-test-key";
    process.env.LANGSMITH_API_KEY = "langsmith-test-key";
    process.env.LANGSMITH_TRACING = "true";
    const { buildTracerProvider } = await import("../../framework/otel.js");

    await expect(buildTracerProvider()).resolves.not.toBeNull();
    expect(mocks.braintrustExporter).toHaveBeenCalledWith({
      url: "https://api.braintrust.dev/otel/v1/traces",
      headers: {
        Authorization: "Bearer braintrust-test-key",
        "x-bt-parent": "project_name:stagehand-dev",
      },
    });
    expect(mocks.langSmithExporter).toHaveBeenCalledOnce();
    expect(constructedSpanProcessors()).toHaveLength(2);
  });

  it("constructs a provider with only the Braintrust processor", async () => {
    process.env.EVAL_TRACE_TRANSPORT = "otel";
    process.env.BRAINTRUST_API_KEY = "braintrust-test-key";
    const { buildTracerProvider } = await import("../../framework/otel.js");

    await expect(buildTracerProvider()).resolves.not.toBeNull();
    expect(mocks.braintrustExporter).toHaveBeenCalledWith({
      url: "https://api.braintrust.dev/otel/v1/traces",
      headers: {
        Authorization: "Bearer braintrust-test-key",
        "x-bt-parent": "project_name:stagehand-dev",
      },
    });
    expect(mocks.langSmithExporter).not.toHaveBeenCalled();
    expect(constructedSpanProcessors()).toHaveLength(1);
  });

  it("uses the provided Braintrust parent over the environment default", async () => {
    process.env.EVAL_TRACE_TRANSPORT = "otel";
    process.env.BRAINTRUST_API_KEY = "braintrust-test-key";
    process.env.BRAINTRUST_OTEL_PARENT = "project_name:from-env";
    const { buildTracerProvider } = await import("../../framework/otel.js");

    await expect(
      buildTracerProvider({ braintrustParent: "project_name:custom" }),
    ).resolves.not.toBeNull();
    expect(mocks.braintrustExporter).toHaveBeenCalledWith({
      url: "https://api.braintrust.dev/otel/v1/traces",
      headers: {
        Authorization: "Bearer braintrust-test-key",
        "x-bt-parent": "project_name:custom",
      },
    });
  });

  it("constructs a provider with only the LangSmith processor", async () => {
    process.env.EVAL_TRACE_TRANSPORT = "otel";
    process.env.LANGSMITH_API_KEY = "langsmith-test-key";
    process.env.LANGSMITH_TRACING = "true";
    const { buildTracerProvider } = await import("../../framework/otel.js");

    await expect(buildTracerProvider()).resolves.not.toBeNull();
    expect(mocks.braintrustExporter).not.toHaveBeenCalled();
    expect(mocks.langSmithExporter).toHaveBeenCalledOnce();
    expect(constructedSpanProcessors()).toHaveLength(1);
  });

  it("shuts down the provider when forceFlush rejects", async () => {
    process.env.EVAL_TRACE_TRANSPORT = "otel";
    process.env.BRAINTRUST_API_KEY = "braintrust-test-key";
    const { buildTracerProvider, shutdownTracing } = await import(
      "../../framework/otel.js"
    );

    await buildTracerProvider();
    const activeProvider = mocks.nodeTracerProvider.mock.results[0]?.value;
    activeProvider.forceFlush.mockRejectedValueOnce(new Error("export failed"));

    await expect(shutdownTracing()).resolves.toBeUndefined();
    expect(activeProvider.shutdown).toHaveBeenCalledOnce();
  });
});
