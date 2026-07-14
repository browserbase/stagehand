import type { LocatorClickParams, LocatorDescriptor } from "../../protocol/types.js";
import {
  buildStagehandProtocolRequest,
  parseStagehandProtocolResponse,
  type StagehandProtocolClient,
} from "./protocolClient.js";

export class Locator {
  constructor(
    private readonly client: StagehandProtocolClient,
    private readonly descriptor: LocatorDescriptor,
  ) {}

  async click(options?: LocatorClickParams["options"]): Promise<void> {
    const request = buildStagehandProtocolRequest("locator.click", {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
    const response = await this.client.send(request);
    parseStagehandProtocolResponse(request.method, response);
  }

  async fill(value: string): Promise<void> {
    const request = buildStagehandProtocolRequest("locator.fill", {
      ...this.descriptor,
      value,
    });
    const response = await this.client.send(request);
    parseStagehandProtocolResponse(request.method, response);
  }

  async isVisible(): Promise<boolean> {
    const request = buildStagehandProtocolRequest("locator.is_visible", this.descriptor);
    const response = await this.client.send(request);
    const result = parseStagehandProtocolResponse(request.method, response);
    return result.visible;
  }

  async textContent(): Promise<string> {
    const request = buildStagehandProtocolRequest("locator.text_content", this.descriptor);
    const response = await this.client.send(request);
    const result = parseStagehandProtocolResponse(request.method, response);
    return result.textContent;
  }
}
