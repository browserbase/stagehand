import type { ContextNewPageParams } from "../../protocol/types.js";
import { StagehandRPC } from "../../protocol/schema-registry.js";
import { Page } from "./page.js";
import type { RPCClient } from "./rpcClient.js";

export class BrowserContext {
  constructor(readonly client: RPCClient) {}

  async pages(): Promise<Page[]> {
    const pageRefs = await this.client.send(StagehandRPC.contextPages, {});
    return pageRefs.map((pageRef) => new Page(this.client, pageRef));
  }

  async newPage(options: ContextNewPageParams = {}): Promise<Page> {
    const pageRef = await this.client.send(StagehandRPC.contextNewPage, options);
    return new Page(this.client, pageRef);
  }
}
