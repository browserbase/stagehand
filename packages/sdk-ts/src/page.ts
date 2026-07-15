import type { PageGotoParams, PageRef } from "../../protocol/types.js";
import { StagehandRPC } from "../../protocol/schema-registry.js";
import { Locator } from "./locator.js";
import type { RPCClient } from "./rpcClient.js";

export class Page {
  currentRef: PageRef;

  constructor(
    readonly rpcClient: RPCClient,
    ref: PageRef,
  ) {
    this.currentRef = ref;
  }

  get pageId(): string {
    return this.currentRef.pageId;
  }

  get ref(): PageRef {
    return this.currentRef;
  }

  async goto(url: string, options?: PageGotoParams["options"]): Promise<this> {
    this.currentRef = await this.rpcClient.send(StagehandRPC.pageGoto, {
      pageId: this.pageId,
      url,
      ...(options ? { options } : {}),
    });
    return this;
  }

  async url(): Promise<string> {
    const result = await this.rpcClient.send(StagehandRPC.pageUrl, {
      pageId: this.pageId,
    });
    return result.url;
  }

  async title(): Promise<string> {
    const result = await this.rpcClient.send(StagehandRPC.pageTitle, {
      pageId: this.pageId,
    });
    return result.title;
  }

  async close(): Promise<void> {
    await this.rpcClient.send(StagehandRPC.pageClose, { pageId: this.pageId });
  }

  locator(selector: string): Locator {
    return new Locator(this.rpcClient, {
      pageId: this.pageId,
      selector,
    });
  }
}
