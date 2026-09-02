import { LocatorDescriptorSchema } from "@browserbasehq/stagehand-protocol/schemas";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import type {
  LocatorClickParams,
  LocatorCentroidResult,
  LocatorDescriptor,
  LocatorHighlightParams,
  LocatorScrollToParams,
  LocatorSelectOptionParams,
  LocatorSendClickEventParams,
  LocatorTypeParams,
} from "@browserbasehq/stagehand-protocol/types";
import type { StagehandCommandClient } from "./commandClient.js";
import { normalizeFileInput, type FileInput } from "./fileUpload.js";

export type LocatorClickOptions = NonNullable<LocatorClickParams["options"]>;
export type LocatorHighlightOptions = NonNullable<LocatorHighlightParams["options"]>;
export type LocatorSendClickEventOptions = NonNullable<LocatorSendClickEventParams["options"]>;
export type LocatorTypeOptions = NonNullable<LocatorTypeParams["options"]>;

export class Locator {
  constructor(
    readonly rpcClient: StagehandCommandClient,
    readonly descriptor: LocatorDescriptor,
  ) {}

  async click(options?: LocatorClickOptions): Promise<void> {
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

  async highlight(options?: LocatorHighlightOptions): Promise<void> {
    await this.rpcClient.send(StagehandMethods.locatorHighlight, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
  }

  async sendClickEvent(options?: LocatorSendClickEventOptions): Promise<void> {
    await this.rpcClient.send(StagehandMethods.locatorSendClickEvent, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
  }

  async type(text: string, options?: LocatorTypeOptions): Promise<void> {
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

  async setInputFiles(files: FileInput): Promise<void> {
    await this.rpcClient.send(StagehandMethods.locatorSetInputFiles, {
      ...this.descriptor,
      files: await normalizeFileInput(files),
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
