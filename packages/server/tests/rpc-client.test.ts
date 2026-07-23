import { ROOT_CONTEXT, TraceFlags, context, trace } from "@opentelemetry/api";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import { describe, expect, it } from "vite-plus/test";
import { JSONRPCRequestSchema } from "../../protocol/json-rpc/schemas.ts";
import { StagehandMethods } from "../../protocol/schema-registry.ts";
import { ChromeRuntimeClient } from "../clients/chromeRuntimeClient.ts";
import { RPCClient } from "../clients/rpcClient.ts";
import { createStagehandRuntime } from "../runtime.ts";
import { RPCRouter } from "../rpcRouter.ts";

describe("worker RPCClient", () => {
  it("registers a reverse request before Chrome can return its response", async () => {
    let runtimeClient: ChromeRuntimeClient | undefined;
    const runtime = createStagehandRuntime(
      {
        browserSessionFactory: async () => {
          throw new Error("Stagehand browser session factory is not configured");
        },
      },
      {
        tracer: trace.getTracer("worker-rpc-client-test"),
        configure: () => {},
        forceFlush: async () => {},
        shutdown: async () => {},
      },
    );
    const scope = {
      sendToHost(payload: string): void {
        const request = JSONRPCRequestSchema.parse(JSON.parse(payload));
        void runtimeClient?.receive(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: { ok: true, runtime: "service_worker" },
          }),
        );
      },
    };
    runtimeClient = new ChromeRuntimeClient(scope, "sendToHost");
    const client = new RPCClient(runtimeClient, new RPCRouter(runtime), 1_000);

    await expect(client.send(StagehandMethods.ping, {})).resolves.toStrictEqual({
      ok: true,
      runtime: "service_worker",
    });
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
        configure: () => {},
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
            result: { ok: true, runtime: "service_worker" },
          }),
        );
      },
    };
    runtimeClient = new ChromeRuntimeClient(scope, "sendToHost");
    const client = new RPCClient(runtimeClient, new RPCRouter(runtime), 1_000);
    const parentContext = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: TraceFlags.SAMPLED,
    });

    try {
      await context.with(parentContext, () => client.send(StagehandMethods.ping, {}));

      expect(requestTraceparent).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/);
    } finally {
      client.close();
      context.disable();
    }
  });
});
