import type { ContextNewPageParams } from "../../protocol/types.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import { Page } from "./page.js";
import type { RPCClient } from "./rpcClient.js";

export class BrowserContext {
  constructor(readonly rpcClient: RPCClient) {}

  async pages(): Promise<Page[]> {
    const pageRefs = await this.rpcClient.send(StagehandMethods.contextPages, {});
    return pageRefs.map((pageRef) => new Page(this.rpcClient, pageRef));
  }

  async newPage(options: ContextNewPageParams = {}): Promise<Page> {
    const pageRef = await this.rpcClient.send(StagehandMethods.contextNewPage, options);
    return new Page(this.rpcClient, pageRef);
  }
}
