import { LocatorDescriptorSchema } from "../../protocol/schemas.js";
import type {
  LocatorClickParams,
  LocatorCentroidResult,
  LocatorDescriptor,
  LocatorHighlightParams,
  LocatorScrollToParams,
  LocatorSelectOptionParams,
  LocatorSendClickEventParams,
  LocatorTypeParams,
} from "../../protocol/types.js";
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

  async hover(): Promise<void> {
    const request = buildStagehandProtocolRequest("locator.hover", this.descriptor);
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

  async count(): Promise<number> {
    const request = buildStagehandProtocolRequest("locator.count", this.descriptor);
    const response = await this.client.send(request);
    const result = parseStagehandProtocolResponse(request.method, response);
    return result.count;
  }

  async isChecked(): Promise<boolean> {
    const request = buildStagehandProtocolRequest("locator.is_checked", this.descriptor);
    const response = await this.client.send(request);
    const result = parseStagehandProtocolResponse(request.method, response);
    return result.checked;
  }

  async inputValue(): Promise<string> {
    const request = buildStagehandProtocolRequest("locator.input_value", this.descriptor);
    const response = await this.client.send(request);
    const result = parseStagehandProtocolResponse(request.method, response);
    return result.value;
  }

  async isVisible(): Promise<boolean> {
    const request = buildStagehandProtocolRequest("locator.is_visible", this.descriptor);
    const response = await this.client.send(request);
    const result = parseStagehandProtocolResponse(request.method, response);
    return result.visible;
  }

  async innerText(): Promise<string> {
    const request = buildStagehandProtocolRequest("locator.inner_text", this.descriptor);
    const response = await this.client.send(request);
    const result = parseStagehandProtocolResponse(request.method, response);
    return result.text;
  }

  async innerHtml(): Promise<string> {
    const request = buildStagehandProtocolRequest("locator.inner_html", this.descriptor);
    const response = await this.client.send(request);
    const result = parseStagehandProtocolResponse(request.method, response);
    return result.html;
  }

  async textContent(): Promise<string> {
    const request = buildStagehandProtocolRequest("locator.text_content", this.descriptor);
    const response = await this.client.send(request);
    const result = parseStagehandProtocolResponse(request.method, response);
    return result.textContent;
  }

  async scrollTo(percent: LocatorScrollToParams["percent"]): Promise<void> {
    const request = buildStagehandProtocolRequest("locator.scroll_to", {
      ...this.descriptor,
      percent,
    });
    const response = await this.client.send(request);
    parseStagehandProtocolResponse(request.method, response);
  }

  async centroid(): Promise<LocatorCentroidResult> {
    const request = buildStagehandProtocolRequest("locator.centroid", this.descriptor);
    const response = await this.client.send(request);
    return parseStagehandProtocolResponse(request.method, response);
  }

  async highlight(options?: LocatorHighlightParams["options"]): Promise<void> {
    const request = buildStagehandProtocolRequest("locator.highlight", {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
    const response = await this.client.send(request);
    parseStagehandProtocolResponse(request.method, response);
  }

  async sendClickEvent(options?: LocatorSendClickEventParams["options"]): Promise<void> {
    const request = buildStagehandProtocolRequest("locator.send_click_event", {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
    const response = await this.client.send(request);
    parseStagehandProtocolResponse(request.method, response);
  }

  async type(text: string, options?: LocatorTypeParams["options"]): Promise<void> {
    const request = buildStagehandProtocolRequest("locator.type", {
      ...this.descriptor,
      text,
      ...(options ? { options } : {}),
    });
    const response = await this.client.send(request);
    parseStagehandProtocolResponse(request.method, response);
  }

  async selectOption(values: LocatorSelectOptionParams["values"]): Promise<string[]> {
    const request = buildStagehandProtocolRequest("locator.select_option", {
      ...this.descriptor,
      values,
    });
    const response = await this.client.send(request);
    const result = parseStagehandProtocolResponse(request.method, response);
    return result.values;
  }

  first(): Locator {
    return this.nth(0);
  }

  nth(index: number): Locator {
    const parsedDescriptor = LocatorDescriptorSchema.safeParse({
      ...this.descriptor,
      nth: index,
    });

    if (!parsedDescriptor.success) {
      throw parsedDescriptor.error;
    }

    return new Locator(this.client, parsedDescriptor.data);
  }
}
