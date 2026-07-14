import type { ContextNewPageParams } from "../../protocol/types.js";
import { Page } from "./page.js";
import {
  buildStagehandProtocolRequest,
  parseStagehandProtocolResponse,
  type StagehandProtocolClient,
} from "./protocolClient.js";

export class BrowserContext {
  constructor(private readonly client: StagehandProtocolClient) {}

  async pages(): Promise<Page[]> {
    const request = buildStagehandProtocolRequest("context.pages", {});
    const response = await this.client.send(request);
    const pageRefs = parseStagehandProtocolResponse(request.method, response);
    return pageRefs.map((pageRef) => new Page(this.client, pageRef));
  }

  async newPage(options: ContextNewPageParams = {}): Promise<Page> {
    const request = buildStagehandProtocolRequest("context.new_page", options);
    const response = await this.client.send(request);
    const pageRef = parseStagehandProtocolResponse(request.method, response);
    return new Page(this.client, pageRef);
  }
}
