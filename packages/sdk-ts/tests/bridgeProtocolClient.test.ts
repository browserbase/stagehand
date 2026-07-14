import { describe, expect, it } from "vite-plus/test";
import type { StagehandBridge, StagehandServiceWorkerInfo } from "../../modcdp/index.js";
import type { StagehandRpcNotification } from "../../protocol/types.js";
import { BridgeProtocolClient } from "../src/bridgeProtocolClient.js";
import type {
  StagehandMethod,
  StagehandMethodParams,
  StagehandMethodResult,
  StagehandProtocolRequest,
} from "../src/protocolClient.js";

type ProtocolCall<Method extends StagehandMethod = StagehandMethod> = {
  [K in Method]: {
    method: K;
    params: StagehandMethodParams<K>;
  };
}[Method];

class FakeStagehandBridge implements StagehandBridge {
  readonly serviceWorker: StagehandServiceWorkerInfo = {
    targetId: "worker-target",
    url: "chrome-extension://stagehand/service-worker.js",
    title: "Stagehand",
    extensionId: "stagehand-extension",
  };
  readonly calls: ProtocolCall[] = [];
  closed = false;
  #responses = new Map<StagehandMethod, unknown[]>();

  queueResponse<Method extends StagehandMethod>(
    method: Method,
    response: StagehandMethodResult<Method>,
  ): void {
    const responses = this.#responses.get(method) ?? [];
    responses.push(response);
    this.#responses.set(method, responses);
  }

  async send<Method extends StagehandMethod>(
    method: Method,
    params: StagehandMethodParams<Method>,
  ): Promise<StagehandMethodResult<Method>> {
    this.calls.push({ method, params } as ProtocolCall);
    const responses = this.#responses.get(method);
    if (!responses?.length) {
      throw new Error(`No fake response queued for ${method}`);
    }
    return responses.shift() as StagehandMethodResult<Method>;
  }

  onNotification(_listener: (notification: StagehandRpcNotification) => void): () => void {
    return () => {};
  }

  close(): void {
    this.closed = true;
  }
}

describe("BridgeProtocolClient", () => {
  it("forwards protocol sends to the Stagehand bridge", async () => {
    const bridge = new FakeStagehandBridge();
    bridge.queueResponse("page.url", { url: "https://example.com" });
    const client = new BridgeProtocolClient(bridge);

    const request = {
      jsonrpc: "2.0",
      id: 0,
      method: "page.url",
      params: { pageId: "page-1" },
    } satisfies Extract<StagehandProtocolRequest, { method: "page.url" }>;

    await expect(client.send(request)).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 0,
      result: {
        url: "https://example.com",
      },
    });

    expect(bridge.calls).toStrictEqual([
      {
        method: "page.url",
        params: { pageId: "page-1" },
      },
    ]);
  });
});
