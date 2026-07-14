import type { PageGotoParams, PageRef } from "../../protocol/types.js";
import { Locator } from "./locator.js";
import {
  buildStagehandProtocolRequest,
  parseStagehandProtocolResponse,
  type StagehandProtocolClient,
} from "./protocolClient.js";

export class Page {
  #ref: PageRef;

  constructor(
    private readonly client: StagehandProtocolClient,
    ref: PageRef,
  ) {
    this.#ref = ref;
  }

  get pageId(): string {
    return this.#ref.pageId;
  }

  get ref(): PageRef {
    return this.#ref;
  }

  async goto(url: string, options?: PageGotoParams["options"]): Promise<this> {
    const request = buildStagehandProtocolRequest("page.goto", {
      pageId: this.pageId,
      url,
      ...(options ? { options } : {}),
    });
    const response = await this.client.send(request);
    this.#ref = parseStagehandProtocolResponse(request.method, response);
    return this;
  }

  async url(): Promise<string> {
    const request = buildStagehandProtocolRequest("page.url", {
      pageId: this.pageId,
    });
    const response = await this.client.send(request);
    const result = parseStagehandProtocolResponse(request.method, response);
    return result.url;
  }

  async title(): Promise<string> {
    const request = buildStagehandProtocolRequest("page.title", {
      pageId: this.pageId,
    });
    const response = await this.client.send(request);
    const result = parseStagehandProtocolResponse(request.method, response);
    return result.title;
  }

  async close(): Promise<void> {
    const request = buildStagehandProtocolRequest("page.close", { pageId: this.pageId });
    const response = await this.client.send(request);
    parseStagehandProtocolResponse(request.method, response);
  }

  locator(selector: string): Locator {
    return new Locator(this.client, {
      pageId: this.pageId,
      selector,
    });
  }
}
