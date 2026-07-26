import { LocatorDescriptorSchema } from "../../protocol/schemas.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
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
    await this.rpcClient.send(StagehandMethods.locatorClick, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
  }

  async hover(): Promise<void> {
    await this.rpcClient.send(StagehandMethods.locatorHover, this.descriptor);
  }

  async fill(value: string): Promise<void> {
    await this.rpcClient.send(StagehandMethods.locatorFill, {
      ...this.descriptor,
      value,
    });
  }

  async count(): Promise<number> {
    return await this.rpcClient.send(StagehandMethods.locatorCount, this.descriptor);
  }

  async isChecked(): Promise<boolean> {
    return await this.rpcClient.send(StagehandMethods.locatorIsChecked, this.descriptor);
  }

  async inputValue(): Promise<string> {
    return await this.rpcClient.send(StagehandMethods.locatorInputValue, this.descriptor);
  }

  async isVisible(): Promise<boolean> {
    return await this.rpcClient.send(StagehandMethods.locatorIsVisible, this.descriptor);
  }

  async innerText(): Promise<string> {
    return await this.rpcClient.send(StagehandMethods.locatorInnerText, this.descriptor);
  }

  async innerHtml(): Promise<string> {
    return await this.rpcClient.send(StagehandMethods.locatorInnerHtml, this.descriptor);
  }

  async textContent(): Promise<string> {
    return await this.rpcClient.send(StagehandMethods.locatorTextContent, this.descriptor);
  }

  async scrollTo(percent: LocatorScrollToParams["percent"]): Promise<void> {
    await this.rpcClient.send(StagehandMethods.locatorScrollTo, {
      ...this.descriptor,
      percent,
    });
  }

  async centroid(): Promise<LocatorCentroidResult> {
    return this.rpcClient.send(StagehandMethods.locatorCentroid, this.descriptor);
  }

  async highlight(options?: LocatorHighlightParams["options"]): Promise<void> {
    await this.rpcClient.send(StagehandMethods.locatorHighlight, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
  }

  async sendClickEvent(options?: LocatorSendClickEventParams["options"]): Promise<void> {
    await this.rpcClient.send(StagehandMethods.locatorSendClickEvent, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
  }

  async type(text: string, options?: LocatorTypeParams["options"]): Promise<void> {
    await this.rpcClient.send(StagehandMethods.locatorType, {
      ...this.descriptor,
      text,
      ...(options ? { options } : {}),
    });
  }

  async selectOption(values: LocatorSelectOptionParams["values"]): Promise<string[]> {
    return await this.rpcClient.send(StagehandMethods.locatorSelectOption, {
      ...this.descriptor,
      values,
    });
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
