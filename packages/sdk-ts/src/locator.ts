import { LocatorDescriptorSchema } from "@browserbasehq/stagehand-protocol/schemas";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import type {
  LocatorClickParams,
  LocatorCentroidResult,
  LocatorDescriptor,
  LocatorOptions,
  LocatorHighlightParams,
  LocatorScrollToParams,
  LocatorSelectOptionParams,
  LocatorSendClickEventParams,
  LocatorTypeParams,
} from "@browserbasehq/stagehand-protocol/types";
import type { StagehandCommandClient } from "./commandClient.js";
import { normalizeFileInput, type FileInput } from "./fileUpload.js";

export type { LocatorOptions } from "@browserbasehq/stagehand-protocol/types";

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

  async hover(options?: LocatorOptions): Promise<void> {
    await this.rpcClient.send(StagehandMethods.locatorHover, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
  }

  async fill(value: string, options?: LocatorOptions): Promise<void> {
    await this.rpcClient.send(StagehandMethods.locatorFill, {
      ...this.descriptor,
      value,
      ...(options ? { options } : {}),
    });
  }

  async count(options?: LocatorOptions): Promise<number> {
    return await this.rpcClient.send(StagehandMethods.locatorCount, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
  }

  async isChecked(options?: LocatorOptions): Promise<boolean> {
    return await this.rpcClient.send(StagehandMethods.locatorIsChecked, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
  }

  async inputValue(options?: LocatorOptions): Promise<string> {
    return await this.rpcClient.send(StagehandMethods.locatorInputValue, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
  }

  async isVisible(options?: LocatorOptions): Promise<boolean> {
    return await this.rpcClient.send(StagehandMethods.locatorIsVisible, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
  }

  async innerText(options?: LocatorOptions): Promise<string> {
    return await this.rpcClient.send(StagehandMethods.locatorInnerText, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
  }

  async innerHtml(options?: LocatorOptions): Promise<string> {
    return await this.rpcClient.send(StagehandMethods.locatorInnerHtml, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
  }

  async textContent(options?: LocatorOptions): Promise<string> {
    return await this.rpcClient.send(StagehandMethods.locatorTextContent, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
  }

  async scrollTo(
    percent: LocatorScrollToParams["percent"],
    options?: LocatorOptions,
  ): Promise<void> {
    await this.rpcClient.send(StagehandMethods.locatorScrollTo, {
      ...this.descriptor,
      percent,
      ...(options ? { options } : {}),
    });
  }

  async centroid(options?: LocatorOptions): Promise<LocatorCentroidResult> {
    return this.rpcClient.send(StagehandMethods.locatorCentroid, {
      ...this.descriptor,
      ...(options ? { options } : {}),
    });
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

  async selectOption(
    values: LocatorSelectOptionParams["values"],
    options?: LocatorOptions,
  ): Promise<string[]> {
    return await this.rpcClient.send(StagehandMethods.locatorSelectOption, {
      ...this.descriptor,
      values,
      ...(options ? { options } : {}),
    });
  }

  async setInputFiles(files: FileInput, options?: LocatorOptions): Promise<void> {
    await this.rpcClient.send(StagehandMethods.locatorSetInputFiles, {
      ...this.descriptor,
      files: await normalizeFileInput(files),
      ...(options ? { options } : {}),
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
