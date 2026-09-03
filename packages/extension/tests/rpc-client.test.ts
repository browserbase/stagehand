import { ROOT_CONTEXT, TraceFlags, context, trace } from "@opentelemetry/api";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import { describe, expect, it, vi } from "vitest";
import { JSONRPCRequestSchema } from "@browserbasehq/stagehand-protocol/json-rpc/schemas";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import { ChromeRuntimeClient } from "../clients/chromeRuntimeClient.ts";
import { RPCClient } from "../clients/rpcClient.ts";
import { createStagehandRuntime } from "../runtime.ts";
import { RPCRouter } from "../rpcRouter.ts";

describe("worker RPCClient", () => {
  function createRuntime() {
    return createStagehandRuntime(
      {
        browserSessionFactory: async () => {
          throw new Error("Stagehand browser session factory is not configured");
        },
      },
      {
        tracer: trace.getTracer("worker-rpc-client-test"),
        configure: async () => {},
        forceFlush: async () => {},
        shutdown: async () => {},
      },
    );
  }

  it("registers a reverse request before Chrome can return its response", async () => {
    let runtimeClient: ChromeRuntimeClient | undefined;
    const runtime = createRuntime();
    const scope = {
      sendToHost(payload: string): void {
        const request = JSONRPCRequestSchema.parse(JSON.parse(payload));
        void runtimeClient?.receive(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: [],
          }),
        );
      },
    };
    runtimeClient = new ChromeRuntimeClient(scope, "sendToHost");
    const client = new RPCClient(runtimeClient, new RPCRouter(runtime));

    await expect(client.send(StagehandMethods.contextPages, {})).resolves.toStrictEqual([]);
  });

  it("continues the active worker trace when requesting SDK work", async () => {
    const contextManager = new StackContextManager().enable();
    context.setGlobalContextManager(contextManager);
    let requestTraceparent: string | undefined;
    let runtimeClient: ChromeRuntimeClient | undefined;
    const runtime = createStagehandRuntime(
      {
        browserSessionFactory: async () => {
          throw new Error("Stagehand browser session factory is not configured");
        },
      },
      {
        tracer: trace.getTracer("worker-rpc-client-trace-test"),
        configure: async () => {},
        forceFlush: async () => {},
        shutdown: async () => {},
      },
    );
    const scope = {
      sendToHost(payload: string): void {
        const request = JSONRPCRequestSchema.parse(JSON.parse(payload));
        requestTraceparent = request.traceparent;
        void runtimeClient?.receive(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: [],
          }),
        );
      },
    };
    runtimeClient = new ChromeRuntimeClient(scope, "sendToHost");
    const client = new RPCClient(runtimeClient, new RPCRouter(runtime));
    const parentContext = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: TraceFlags.SAMPLED,
    });

    try {
      await context.with(parentContext, () => client.send(StagehandMethods.contextPages, {}));

      expect(requestTraceparent).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/);
    } finally {
      client.close();
      context.disable();
    }
  });

  it("waits for SDK work without imposing a reverse JSON-RPC deadline", async () => {
    vi.useFakeTimers();
    let runtimeClient: ChromeRuntimeClient | undefined;
    let requestId: number | undefined;
    const scope = {
      sendToHost(payload: string): void {
        requestId = JSONRPCRequestSchema.parse(JSON.parse(payload)).id;
      },
    };
    runtimeClient = new ChromeRuntimeClient(scope, "sendToHost");
    const client = new RPCClient(runtimeClient, new RPCRouter(createRuntime()));

    try {
      const request = client.send(StagehandMethods.contextPages, {});
      await vi.advanceTimersByTimeAsync(120_000);

      expect(client.pending.size).toBe(1);
      await runtimeClient.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          result: [],
        }),
      );
      await expect(request).resolves.toStrictEqual([]);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("disposes the Stagehand instance before sending the stagehand.close response", async () => {
    const lifecycle: string[] = [];
    const runtime = createRuntime();
    vi.spyOn(runtime.tracing, "forceFlush").mockImplementation(async () => {
      lifecycle.push("flush");
    });
    const runtimeClient = new ChromeRuntimeClient(
      {
        sendToHost(): void {
          lifecycle.push("response");
        },
      },
      "sendToHost",
    );
    const closeStagehand = vi.fn(async () => {
      lifecycle.push("dispose");
    });
    const client = new RPCClient(runtimeClient, new RPCRouter(runtime, { closeStagehand }));

    try {
      await runtimeClient.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 9,
          method: "stagehand.close",
          params: {},
        }),
      );

      expect(lifecycle).toStrictEqual(["dispose", "flush", "response"]);
      expect(closeStagehand).toHaveBeenCalledOnce();
    } finally {
      client.close();
    }
  });

  it("sends the stagehand.close response when tracing flush fails", async () => {
    const responses: Array<Record<string, unknown>> = [];
    const runtime = createRuntime();
    vi.spyOn(runtime.tracing, "forceFlush").mockRejectedValue(new Error("export failed"));
    const runtimeClient = new ChromeRuntimeClient(
      {
        sendToHost(payload: string): void {
          responses.push(JSON.parse(payload) as Record<string, unknown>);
        },
      },
      "sendToHost",
    );
    const client = new RPCClient(runtimeClient, new RPCRouter(runtime));

    try {
      await expect(
        runtimeClient.receive(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 10,
            method: "stagehand.close",
            params: {},
          }),
        ),
      ).resolves.toBeUndefined();
      expect(responses).toStrictEqual([{ jsonrpc: "2.0", id: 10, result: { closed: true } }]);
    } finally {
      client.close();
    }
  });

  it("waits for active Stagehand instance requests before closing", async () => {
    let markRequestStarted!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    let releaseRequest!: () => void;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const responses: Array<Record<string, unknown>> = [];
    const runtimeClient = new ChromeRuntimeClient(
      {
        sendToHost(payload: string): void {
          responses.push(JSON.parse(payload) as Record<string, unknown>);
        },
      },
      "sendToHost",
    );
    const runtime = createRuntime();
    const router = new RPCRouter(runtime);
    vi.spyOn(router.stagehandController, "act").mockImplementation(async () => {
      markRequestStarted();
      await requestGate;
      const usage = {
        inputTokens: 10,
        outputTokens: 4,
        reasoningTokens: 2,
        cachedInputTokens: 3,
        inferenceTimeMs: 100,
      };
      runtime.metrics.record("act", usage);
      return {
        data: { success: true, message: "", actionDescription: "", actions: [] },
        metadata: { cache: { status: "DISABLED" as const }, usage },
      };
    });
    const client = new RPCClient(runtimeClient, router);

    try {
      const activeRequest = runtimeClient.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 11,
          method: "stagehand.act",
          params: { page_id: "page-1", instruction: "click the link" },
        }),
      );
      await requestStarted;

      let closeFinished = false;
      const closeRequest = runtimeClient
        .receive(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 12,
            method: "stagehand.close",
            params: {},
          }),
        )
        .then(() => {
          closeFinished = true;
        });
      await runtimeClient.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 13,
          method: "stagehand.metrics",
          params: {},
        }),
      );

      expect(closeFinished).toBe(false);
      expect(responses).toMatchObject([
        {
          id: 13,
          error: { message: "Stagehand instance is closing" },
        },
      ]);

      releaseRequest();
      await Promise.all([activeRequest, closeRequest]);

      expect(responses.map((response) => response.id)).toStrictEqual([13, 11, 12]);
      expect(runtime.metrics.snapshot()).toMatchObject({
        actPromptTokens: 0,
        totalPromptTokens: 0,
      });
    } finally {
      client.close();
    }
  });

  it("disposes the Stagehand instance when the stagehand.close response cannot be delivered", async () => {
    const runtimeClient = new ChromeRuntimeClient(
      {
        sendToHost(): void {
          throw new Error("host transport closed");
        },
      },
      "sendToHost",
    );
    const closeStagehand = vi.fn(async () => {});
    const client = new RPCClient(runtimeClient, new RPCRouter(createRuntime(), { closeStagehand }));

    try {
      await expect(
        runtimeClient.receive(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 10,
            method: "stagehand.close",
            params: {},
          }),
        ),
      ).rejects.toThrow("host transport closed");
      expect(closeStagehand).toHaveBeenCalledOnce();
    } finally {
      client.close();
    }
  });

  it.each([
    ["1.0.9", true, undefined],
    ["1.1.0", false, "protocol-server-too-old"],
    ["2.0.0", false, "protocol-major-mismatch"],
    ["1.0.0-beta.1", false, "protocol-prerelease-mismatch"],
  ] as const)(
    "negotiates client protocol %s through the stagehand.init wire handshake",
    async (protocolVersion, compatible, reason) => {
      const responses: Array<Record<string, unknown>> = [];
      const runtimeClient = new ChromeRuntimeClient(
        {
          sendToHost(payload: string): void {
            responses.push(JSON.parse(payload) as Record<string, unknown>);
          },
        },
        "sendToHost",
      );
      const initializeStagehand = vi.fn(async () => ({ initialized: true as const, pages: [] }));
      const client = new RPCClient(
        runtimeClient,
        new RPCRouter(createRuntime(), { initializeStagehand }),
      );

      try {
        await runtimeClient.receive(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 10,
            method: "stagehand.init",
            params: {
              protocol_version: protocolVersion,
              client_info: { name: "stagehand-sdk-test", version: "4.0.0" },
            },
          }),
        );

        if (compatible) {
          expect(responses).toStrictEqual([
            {
              jsonrpc: "2.0",
              id: 10,
              result: { initialized: true, pages: [] },
            },
          ]);
          expect(initializeStagehand).toHaveBeenCalledOnce();
        } else {
          expect(responses).toMatchObject([
            {
              jsonrpc: "2.0",
              id: 10,
              error: {
                code: -32603,
                message: `Incompatible Stagehand protocol (${reason})`,
                data: { name: "StagehandProtocolCompatibilityError" },
              },
            },
          ]);
          expect(initializeStagehand).not.toHaveBeenCalled();
        }
      } finally {
        client.close();
      }
    },
  );

  it("rejects a malformed protocol version as invalid params on the wire", async () => {
    const responses: Array<Record<string, unknown>> = [];
    const runtimeClient = new ChromeRuntimeClient(
      {
        sendToHost(payload: string): void {
          responses.push(JSON.parse(payload) as Record<string, unknown>);
        },
      },
      "sendToHost",
    );
    const initializeStagehand = vi.fn(async () => ({ initialized: true as const, pages: [] }));
    const client = new RPCClient(
      runtimeClient,
      new RPCRouter(createRuntime(), { initializeStagehand }),
    );

    try {
      await runtimeClient.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 11,
          method: "stagehand.init",
          params: {
            protocol_version: "not-semver",
            client_info: { name: "stagehand-sdk-test", version: "4.0.0" },
          },
        }),
      );

      expect(responses).toMatchObject([
        {
          id: 11,
          error: { code: -32602, data: { name: "ZodError" } },
        },
      ]);
      expect(initializeStagehand).not.toHaveBeenCalled();
    } finally {
      client.close();
    }
  });
});
