import { writeFile } from "node:fs/promises";
import type {
  LoadState,
  PageCDPEvent,
  PageEventName,
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
import { StagehandNotifications } from "../../protocol/schema-registry.js";
import { Locator } from "./locator.js";
import {
  type InitScriptSource,
  normalizeEvaluationExpression,
  normalizeInitScriptSource,
} from "./pageScripts.js";
import type { RPCClient } from "./rpcClient.js";
import { Response } from "./response.js";
import { WebMCPTool } from "./webmcp.js";
import type { WebMCPToolsOptions } from "./clientSchemas.js";

export type ScreenshotOptions = Omit<PageScreenshotOptions, "mask"> & {
  mask?: Locator[];
  path?: string;
};

export interface PageEventListener {
  (event: PageCDPEvent): unknown;
}

export class CDPSubscription {
  private unsubscribePromise: Promise<void> | undefined;

  constructor(
    private readonly rpcClient: RPCClient,
    private readonly subscriptionId: string,
    private readonly removeLocalListener: () => void,
    private readonly onDisposed: () => void,
  ) {}

  unsubscribe(): Promise<void> {
    this.unsubscribePromise ??= this.unsubscribeOnce().catch((error: unknown) => {
      this.unsubscribePromise = undefined;
      throw error;
    });
    return this.unsubscribePromise;
  }

  private async unsubscribeOnce(): Promise<void> {
    this.removeLocalListener();
    this.onDisposed();
    await this.rpcClient.send(StagehandMethods.pageOff, {
      subscriptionId: this.subscriptionId,
    });
  }
}

export class Page {
  currentRef: PageRef;
  private readonly eventSubscriptions = new Set<CDPSubscription>();

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

  async on(event: PageEventName, listener: PageEventListener): Promise<CDPSubscription> {
    const subscriptionId = crypto.randomUUID();
    const removeNotificationListener = this.rpcClient.onNotification((notification) => {
      if (
        notification.method !== StagehandNotifications.pageCDPEvent.name ||
        notification.params.subscriptionId !== subscriptionId
      ) {
        return;
      }
      try {
        const result = listener(notification.params.event);
        if (result && typeof result === "object" && "then" in result) {
          void Promise.resolve(result).catch(reportPageEventListenerError);
        }
      } catch (error) {
        reportPageEventListenerError(error);
      }
    });

    let subscription: CDPSubscription;
    subscription = new CDPSubscription(
      this.rpcClient,
      subscriptionId,
      removeNotificationListener,
      () => this.eventSubscriptions.delete(subscription),
    );
    this.eventSubscriptions.add(subscription);

    try {
      await this.rpcClient.send(StagehandMethods.pageOn, {
        pageId: this.pageId,
        subscriptionId,
        event,
      });
      return subscription;
    } catch (error) {
      removeNotificationListener();
      this.eventSubscriptions.delete(subscription);
      throw error;
    }
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
    await Promise.allSettled(
      [...this.eventSubscriptions].map((subscription) => subscription.unsubscribe()),
    );
    await this.rpcClient.send(StagehandMethods.pageClose, { pageId: this.pageId });
  }

  locator(selector: string): Locator {
    return new Locator(this.rpcClient, {
      pageId: this.pageId,
      selector,
    });
  }
}

function reportPageEventListenerError(error: unknown): void {
  process.emitWarning(error instanceof Error ? error.message : String(error), {
    code: "STAGEHAND_PAGE_EVENT_LISTENER_ERROR",
  });
}
