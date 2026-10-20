import { expect, it, onTestFinished } from "vitest";
import { JSONRPCErrorCodes } from "@browserbasehq/stagehand-protocol/json-rpc/schemas";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import { createHttpTestServer, listen, close } from "../../sdk-ts/tests/helpers/httpServer.js";
import { requestBrowserbase } from "../clients/browserbaseClient.js";
import { createBrowserbaseTestBridge } from "./helpers/browserbaseBridge.js";

const connection = { apiKey: "test", sessionId: "session", apiUrl: "http://127.0.0.1:1/v1" };
const params = { operation: "gateway.responses" as const, headers: {}, body: "{}" };

it.each(["AbortError", "TimeoutError"])(
  "forwards %s to the bridge's HTTP request",
  async (name) => {
    let received!: () => void;
    let disconnected!: () => void;
    const arrived = new Promise<void>((resolve) => {
      received = resolve;
    });
    const closed = new Promise<void>((resolve) => {
      disconnected = resolve;
    });
    const server = createHttpTestServer((_request, response) => {
      response.once("close", disconnected);
      response.writeHead(200, { "content-type": "application/json" });
      response.write(" ");
      received();
    });
    const apiUrl = `${await listen(server)}/v1`;
    const bridge = createBrowserbaseTestBridge({ ...connection, apiUrl });
    const controller = new AbortController();
    onTestFinished(async () => {
      controller.abort();
      await close(server);
      bridge.rpc.close();
      await Promise.all(bridge.pendingReplies);
    });

    const rejected = expect(
      requestBrowserbase(bridge.rpc, params, controller.signal),
    ).rejects.toMatchObject({ name });
    await arrived;
    controller.abort(new DOMException("stop", name));
    await rejected;
    await closed;
    await Promise.all(bridge.pendingReplies);
    expect(bridge.rpc.pending.size).toBe(0);
  },
);

it("replies with an RPC error when HTTP request construction fails", async () => {
  const bridge = createBrowserbaseTestBridge(connection);
  onTestFinished(() => bridge.rpc.close());

  await expect(
    bridge.rpc.send(StagehandMethods.browserbaseRequest, {
      ...params,
      headers: { "invalid header": "value" },
    }),
  ).rejects.toMatchObject({
    message: "Invalid Browserbase HTTP request",
    cause: { code: JSONRPCErrorCodes.internalError },
  });
  await expect(Promise.all(bridge.pendingReplies)).resolves.toEqual([undefined]);
  expect(bridge.rpc.pending.size).toBe(0);
});
