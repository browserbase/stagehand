import type {
  LoadState,
  PageClickParams,
  PageDragAndDropParams,
  PageKeyPressParams,
  PageNavigationOptions,
  PageRef,
  PageReloadParams,
  PageScreenshotOptions,
  PageSetExtraHTTPHeadersParams,
  PageSetViewportSizeParams,
  PageSnapshotOptions,
  SnapshotResult,
  PageTypeParams,
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
import type { StagehandCommandClient } from "./commandClient.js";
import { Response } from "./response.js";
import { WebMCPTool } from "./webmcp.js";
import type { WebMCPToolsOptions } from "./clientSchemas.js";

export type ScreenshotOptions = Omit<PageScreenshotOptions, "mask"> & {
  mask?: Locator[];
  path?: string;
};

export class Page {
  currentRef: PageRef;

  constructor(
    readonly rpcClient: StagehandCommandClient,
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

  async goto(url: string, options?: PageNavigationOptions): Promise<Response | null> {
    const result = await this.rpcClient.send(StagehandMethods.pageGoto, {
      pageId: this.pageId,
      url,
      ...(options ? { options } : {}),
    });
    this.currentRef = result.page;
    return result.response === null ? null : new Response(this.rpcClient, result.response);
  }

  async reload(options?: PageReloadParams["options"]): Promise<Response | null> {
    const result = await this.rpcClient.send(StagehandMethods.pageReload, {
      pageId: this.pageId,
      ...(options ? { options } : {}),
    });
    this.currentRef = result.page;
    return result.response === null ? null : new Response(this.rpcClient, result.response);
  }

  async goBack(options?: PageNavigationOptions): Promise<Response | null> {
    const result = await this.rpcClient.send(StagehandMethods.pageGoBack, {
      pageId: this.pageId,
      ...(options ? { options } : {}),
    });
    this.currentRef = result.page;
    return result.response === null ? null : new Response(this.rpcClient, result.response);
  }

  async goForward(options?: PageNavigationOptions): Promise<Response | null> {
    const result = await this.rpcClient.send(StagehandMethods.pageGoForward, {
      pageId: this.pageId,
      ...(options ? { options } : {}),
    });
    this.currentRef = result.page;
    return result.response === null ? null : new Response(this.rpcClient, result.response);
  }

  async click(x: number, y: number, options?: PageClickParams["options"]): Promise<void> {
    await this.rpcClient.send(StagehandMethods.pageClick, {
      pageId: this.pageId,
      x,
      y,
      ...(options ? { options } : {}),
    });
  }

  async hover(x: number, y: number): Promise<void> {
    await this.rpcClient.send(StagehandMethods.pageHover, {
      pageId: this.pageId,
      x,
      y,
    });
  }

  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    await this.rpcClient.send(StagehandMethods.pageScroll, {
      pageId: this.pageId,
      x,
      y,
      deltaX,
      deltaY,
    });
  }

  async dragAndDrop(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options?: PageDragAndDropParams["options"],
  ): Promise<void> {
    await this.rpcClient.send(StagehandMethods.pageDragAndDrop, {
      pageId: this.pageId,
      fromX,
      fromY,
      toX,
      toY,
      ...(options ? { options } : {}),
    });
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

  async waitForLoadState(state: LoadState, timeout?: number): Promise<void> {
    await this.rpcClient.send(StagehandMethods.pageWaitForLoadState, {
      pageId: this.pageId,
      state,
      ...(timeout === undefined ? {} : { timeout }),
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

  async screenshot(options?: ScreenshotOptions): Promise<Uint8Array> {
    const { path, mask, ...screenshotOptions } = options ?? {};
    const result = await this.rpcClient.send(StagehandMethods.pageScreenshot, {
      pageId: this.pageId,
      options: {
        ...screenshotOptions,
        ...(mask ? { mask: mask.map((locator) => locator.descriptor) } : {}),
      },
    });
    const bytes = decodeBase64(result.data);
    if (path) {
      const moduleName = "node:" + "fs/promises";
      const { writeFile } = (await import(
        /* @vite-ignore */ moduleName
      )) as typeof import("node:fs/promises");
      await writeFile(path, bytes);
    }
    return bytes;
  }

  async snapshot(options?: PageSnapshotOptions): Promise<SnapshotResult> {
    return await this.rpcClient.send(StagehandMethods.pageSnapshot, {
      pageId: this.pageId,
      ...(options ? { options } : {}),
    });
  }

  async tools(options?: WebMCPToolsOptions): Promise<WebMCPTool[]> {
    const result = await this.rpcClient.send(StagehandMethods.pageWebMCPTools, {
      pageId: this.pageId,
      ...(options ? { options } : {}),
    });
    return result.tools.map(
      (descriptor) => new WebMCPTool(this.rpcClient, this.pageId, descriptor),
    );
  }

  async url(): Promise<string> {
    return await this.rpcClient.send(StagehandMethods.pageUrl, {
      pageId: this.pageId,
    });
  }

  async title(): Promise<string> {
    return await this.rpcClient.send(StagehandMethods.pageTitle, {
      pageId: this.pageId,
    });
  }

  async close(): Promise<void> {
    await this.rpcClient.send(StagehandMethods.pageClose, { pageId: this.pageId });
  }

  locator(selector: string): Locator {
    return new Locator(this.rpcClient, {
      pageId: this.pageId,
      selector,
    });
  }
}

function decodeBase64(value: string): Uint8Array {
  const nodeBuffer = (globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer;
  if (nodeBuffer) return nodeBuffer.from(value, "base64");
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
