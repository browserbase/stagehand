import { trace } from "@opentelemetry/api";
import { describe, expect, it } from "vite-plus/test";
import { JSONRPCRequestSchema } from "../../protocol/json-rpc/schemas.ts";
import { StagehandRPC } from "../../protocol/schema-registry.ts";
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

    await expect(client.send(StagehandRPC.ping, {})).resolves.toStrictEqual({
      ok: true,
      runtime: "service_worker",
    });
  });
});
