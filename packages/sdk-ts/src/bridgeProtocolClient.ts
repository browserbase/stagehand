import type { StagehandBridge } from "../../modcdp/index.js";
import type { StagehandProtocolClient, StagehandProtocolRequest } from "./protocolClient.js";

export class BridgeProtocolClient implements StagehandProtocolClient {
  constructor(private readonly bridge: StagehandBridge) {}

  async send(request: StagehandProtocolRequest): Promise<unknown> {
    const result = await this.bridge.send(request.method, request.params);
    return {
      jsonrpc: "2.0",
      id: request.id,
      result,
    };
  }
}
