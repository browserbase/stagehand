import { writeFile } from "node:fs/promises";
import { z } from "zod/v4";
import type {
  PageClickParams,
  PageDragAndDropParams,
  PageGoBackParams,
  PageGoForwardParams,
  PageGotoParams,
  PageHoverParams,
  PageKeyPressParams,
  PageRef,
  PageReloadParams,
  PageScrollParams,
  PageScreenshotOptions,
  PageSetExtraHTTPHeadersParams,
  PageSetViewportSizeParams,
  PageSnapshotOptions,
  StagehandExtractParams,
  SnapshotResult,
  PageTypeParams,
  PageWaitForLoadStateParams,
  PageWaitForSelectorParams,
  PageWaitForTimeoutParams,
} from "../../protocol/types.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import { Locator } from "./locator.js";
import {
  type InitScriptSource,
  normalizeEvaluationExpression,
  normalizeInitScriptSource,
} from "./pageScripts.js";
import type { RPCClient } from "./rpcClient.js";

export type ScreenshotOptions = Omit<PageScreenshotOptions, "mask"> & {
  mask?: Locator[];
  path?: string;
};

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
    this.currentRef = await this.rpcClient.send(StagehandMethods.pageGoto, {
      pageId: this.pageId,
      url,
      ...(options ? { options } : {}),
    });
    return this;
  }

  async reload(options?: PageReloadParams["options"]): Promise<this> {
    this.currentRef = await this.rpcClient.send(StagehandMethods.pageReload, {
      pageId: this.pageId,
      ...(options ? { options } : {}),
    });
    return this;
  }

  async goBack(options?: PageGoBackParams["options"]): Promise<this> {
    this.currentRef = await this.rpcClient.send(StagehandMethods.pageGoBack, {
      pageId: this.pageId,
      ...(options ? { options } : {}),
    });
    return this;
  }

  async goForward(options?: PageGoForwardParams["options"]): Promise<this> {
    this.currentRef = await this.rpcClient.send(StagehandMethods.pageGoForward, {
      pageId: this.pageId,
      ...(options ? { options } : {}),
    });
    return this;
  }

  async click(x: number, y: number, options?: PageClickParams["options"]): Promise<string> {
    const result = await this.rpcClient.send(StagehandMethods.pageClick, {
      pageId: this.pageId,
      x,
      y,
      ...(options ? { options } : {}),
    });
    return result.xpath;
  }

  async hover(x: number, y: number, options?: PageHoverParams["options"]): Promise<string> {
    const result = await this.rpcClient.send(StagehandMethods.pageHover, {
      pageId: this.pageId,
      x,
      y,
      ...(options ? { options } : {}),
    });
    return result.xpath;
  }

  async scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    options?: PageScrollParams["options"],
  ): Promise<string> {
    const result = await this.rpcClient.send(StagehandMethods.pageScroll, {
      pageId: this.pageId,
      x,
      y,
      deltaX,
      deltaY,
      ...(options ? { options } : {}),
    });
    return result.xpath;
  }

  async dragAndDrop(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options?: PageDragAndDropParams["options"],
  ): Promise<[string, string]> {
    const result = await this.rpcClient.send(StagehandMethods.pageDragAndDrop, {
      pageId: this.pageId,
      fromX,
      fromY,
      toX,
      toY,
      ...(options ? { options } : {}),
    });
    return [result.fromXpath, result.toXpath];
  }

  async type(text: string, options?: PageTypeParams["options"]): Promise<void> {
    await this.rpcClient.send(StagehandMethods.pageType, {
      pageId: this.pageId,
      text,
      ...(options ? { options } : {}),
    });
  }

  async keyPress(key: string, options?: PageKeyPressParams["options"]): Promise<void> {
    await this.rpcClient.send(StagehandMethods.pageKeyPress, {
      pageId: this.pageId,
      key,
      ...(options ? { options } : {}),
    });
  }

  async evaluate<R = unknown, Arg = unknown>(
    expression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    const result = await this.rpcClient.send(StagehandMethods.pageEvaluate, {
      pageId: this.pageId,
      expression: normalizeEvaluationExpression(expression, arg),
    });
    return result.value as R;
  }

  async addInitScript<Arg = unknown>(script: InitScriptSource<Arg>, arg?: Arg): Promise<void> {
    const source = await normalizeInitScriptSource(script, arg);
    await this.rpcClient.send(StagehandMethods.pageAddInitScript, {
      pageId: this.pageId,
      source,
    });
  }

  async setExtraHTTPHeaders(headers: PageSetExtraHTTPHeadersParams["headers"]): Promise<void> {
    await this.rpcClient.send(StagehandMethods.pageSetExtraHTTPHeaders, {
      pageId: this.pageId,
      headers,
    });
  }

  async setViewportSize(
    width: number,
    height: number,
    options?: PageSetViewportSizeParams["options"],
  ): Promise<void> {
    await this.rpcClient.send(StagehandMethods.pageSetViewportSize, {
      pageId: this.pageId,
      width,
      height,
      ...(options ? { options } : {}),
    });
  }

  async waitForLoadState(
    state: PageWaitForLoadStateParams["state"],
    timeoutMs?: number,
  ): Promise<void> {
    await this.rpcClient.send(StagehandMethods.pageWaitForLoadState, {
      pageId: this.pageId,
      state,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  }

  async waitForTimeout(ms: PageWaitForTimeoutParams["ms"]): Promise<void> {
    await this.rpcClient.send(StagehandMethods.pageWaitForTimeout, {
      pageId: this.pageId,
      ms,
    });
  }

  async waitForSelector(
    selector: string,
    options?: PageWaitForSelectorParams["options"],
  ): Promise<boolean> {
    const result = await this.rpcClient.send(StagehandMethods.pageWaitForSelector, {
      pageId: this.pageId,
      selector,
      ...(options ? { options } : {}),
    });
    return result.matched;
  }

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    const { path, mask, ...screenshotOptions } = options ?? {};
    const result = await this.rpcClient.send(StagehandMethods.pageScreenshot, {
      pageId: this.pageId,
      options: {
        ...screenshotOptions,
        ...(mask ? { mask: mask.map((locator) => locator.descriptor) } : {}),
      },
    });
    const bytes = Buffer.from(result.data, "base64");
    if (path) await writeFile(path, bytes);
    return bytes;
  }

  async snapshot(options?: PageSnapshotOptions): Promise<SnapshotResult> {
    return await this.rpcClient.send(StagehandMethods.pageSnapshot, {
      pageId: this.pageId,
      ...(options ? { options } : {}),
    });
  }

  async url(): Promise<string> {
    const result = await this.rpcClient.send(StagehandMethods.pageUrl, {
      pageId: this.pageId,
    });
    return result.url;
  }

  async title(): Promise<string> {
    const result = await this.rpcClient.send(StagehandMethods.pageTitle, {
      pageId: this.pageId,
    });
    return result.title;
  }

  async close(): Promise<void> {
    await this.rpcClient.send(StagehandMethods.pageClose, { pageId: this.pageId });
  }

  async extract<Schema extends z.ZodType>(
    instruction: string,
    schema: Schema,
    options?: StagehandExtractParams["options"],
  ): Promise<z.output<Schema>> {
    const jsonSchema = z.json().parse(z.toJSONSchema(schema));
    const response = await this.rpcClient.send(StagehandMethods.stagehandExtract, {
      pageId: this.pageId,
      instruction,
      schema: jsonSchema,
      ...(options === undefined ? {} : { options }),
    });

    return schema.parse(response.result);
  }

  locator(selector: string): Locator {
    return new Locator(this.rpcClient, {
      pageId: this.pageId,
      selector,
    });
  }
}
