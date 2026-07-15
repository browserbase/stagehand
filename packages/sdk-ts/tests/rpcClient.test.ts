import { describe, expect, it } from "vite-plus/test";
import type { JSONRPCMessage } from "../../protocol/json-rpc/types.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import { RPCClient, type CDPTransport } from "../src/rpcClient.js";

class FakeCDPTransport implements CDPTransport {
  readonly serviceWorker = {
    targetId: "worker-target",
    url: "chrome-extension://stagehand/service-worker.js",
    title: "Stagehand",
    extensionId: "stagehand",
  };
  onmessage?: (message: unknown) => void | Promise<void>;
  onclose?: (reason?: Error) => void;
  onerror?: (error: Error) => void;
  readonly sent: JSONRPCMessage[] = [];

  constructor(readonly result: unknown) {}

  async send(message: JSONRPCMessage): Promise<void> {
    this.sent.push(message);
    if (!("id" in message) || !("method" in message)) return;
    await this.onmessage?.({ jsonrpc: "2.0", id: message.id, result: this.result });
  }

  close(): void {}
}

describe("RPCClient", () => {
  it("registers the pending request before CDP can return its response", async () => {
    const cdp = new FakeCDPTransport({
      page_id: "page-1",
      url: "https://example.com",
    });
    const client = new RPCClient(cdp, 1_000);

    await expect(
      client.send(StagehandMethods.pageGoto, {
        pageId: "page-1",
        url: "https://example.com",
      }),
    ).resolves.toStrictEqual({
      pageId: "page-1",
      url: "https://example.com",
    });

    expect(cdp.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "page.goto",
      params: {
        page_id: "page-1",
        url: "https://example.com",
      },
    });
  });

  it("rejects invalid method params before sending them over CDP", async () => {
    const cdp = new FakeCDPTransport({ ok: true, runtime: "service_worker" });
    const client = new RPCClient(cdp, 1_000);

    await expect(client.send(StagehandMethods.ping, { extra: true } as never)).rejects.toThrow();

    expect(cdp.sent).toStrictEqual([]);
  });
});
