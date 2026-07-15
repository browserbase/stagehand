import { LocatorDescriptorSchema } from "../../protocol/schemas.js";
import { StagehandRPC } from "../../protocol/schema-registry.js";
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
import type { RPCClient } from "./rpcClient.js";

export class Locator {
  constructor(
    readonly rpcClient: RPCClient,
    readonly descriptor: LocatorDescriptor,
  ) {}

  async click(options?: LocatorClickParams["options"]): Promise<void> {
    await this.rpcClient.send(StagehandRPC.locatorClick, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
  }

  async hover(): Promise<void> {
    await this.rpcClient.send(StagehandRPC.locatorHover, this.descriptor);
  }

  async fill(value: string): Promise<void> {
    await this.rpcClient.send(StagehandRPC.locatorFill, {
      ...this.descriptor,
      value,
    });
  }

  async count(): Promise<number> {
    const result = await this.rpcClient.send(StagehandRPC.locatorCount, this.descriptor);
    return result.count;
  }

  async isChecked(): Promise<boolean> {
    const result = await this.rpcClient.send(StagehandRPC.locatorIsChecked, this.descriptor);
    return result.checked;
  }

  async inputValue(): Promise<string> {
    const result = await this.rpcClient.send(StagehandRPC.locatorInputValue, this.descriptor);
    return result.value;
  }

  async isVisible(): Promise<boolean> {
    const result = await this.rpcClient.send(StagehandRPC.locatorIsVisible, this.descriptor);
    return result.visible;
  }

  async innerText(): Promise<string> {
    const result = await this.rpcClient.send(StagehandRPC.locatorInnerText, this.descriptor);
    return result.text;
  }

  async innerHtml(): Promise<string> {
    const result = await this.rpcClient.send(StagehandRPC.locatorInnerHtml, this.descriptor);
    return result.html;
  }

  async textContent(): Promise<string> {
    const result = await this.rpcClient.send(StagehandRPC.locatorTextContent, this.descriptor);
    return result.textContent;
  }

  async scrollTo(percent: LocatorScrollToParams["percent"]): Promise<void> {
    await this.rpcClient.send(StagehandRPC.locatorScrollTo, {
      ...this.descriptor,
      percent,
    });
  }

  async centroid(): Promise<LocatorCentroidResult> {
    return this.rpcClient.send(StagehandRPC.locatorCentroid, this.descriptor);
  }

  async highlight(options?: LocatorHighlightParams["options"]): Promise<void> {
    await this.rpcClient.send(StagehandRPC.locatorHighlight, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
  }

  async sendClickEvent(options?: LocatorSendClickEventParams["options"]): Promise<void> {
    await this.rpcClient.send(StagehandRPC.locatorSendClickEvent, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
  }

  async type(text: string, options?: LocatorTypeParams["options"]): Promise<void> {
    await this.rpcClient.send(StagehandRPC.locatorType, {
      ...this.descriptor,
      text,
      ...(options ? { options } : {}),
    });
  }

  async selectOption(values: LocatorSelectOptionParams["values"]): Promise<string[]> {
    const result = await this.rpcClient.send(StagehandRPC.locatorSelectOption, {
      ...this.descriptor,
      values,
    });
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

    return new Locator(this.rpcClient, parsedDescriptor.data);
  }
}
