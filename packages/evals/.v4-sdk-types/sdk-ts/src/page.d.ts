import type { LoadState, PageClickParams, PageDragAndDropParams, PageHoverParams, PageKeyPressParams, PageNavigationOptions, PageRef, PageReloadParams, PageScrollParams, PageScreenshotOptions, PageSetExtraHTTPHeadersParams, PageSetViewportSizeParams, PageSnapshotOptions, SnapshotResult, PageTypeParams, PageWaitForSelectorParams, PageWaitForTimeoutParams } from "../../protocol/types.js";
import { Locator } from "./locator.js";
import { type InitScriptSource } from "./pageScripts.js";
import type { RPCClient } from "./rpcClient.js";
export type ScreenshotOptions = Omit<PageScreenshotOptions, "mask"> & {
    mask?: Locator[];
    path?: string;
};
export declare class Page {
    readonly rpcClient: RPCClient;
    currentRef: PageRef;
    constructor(rpcClient: RPCClient, ref: PageRef);
    get pageId(): string;
    get ref(): PageRef;
    goto(url: string, options?: PageNavigationOptions): Promise<this>;
    reload(options?: PageReloadParams["options"]): Promise<this>;
    goBack(options?: PageNavigationOptions): Promise<this>;
    goForward(options?: PageNavigationOptions): Promise<this>;
    click(x: number, y: number, options?: PageClickParams["options"]): Promise<string>;
    hover(x: number, y: number, options?: PageHoverParams["options"]): Promise<string>;
    scroll(x: number, y: number, deltaX: number, deltaY: number, options?: PageScrollParams["options"]): Promise<string>;
    dragAndDrop(fromX: number, fromY: number, toX: number, toY: number, options?: PageDragAndDropParams["options"]): Promise<[string, string]>;
    type(text: string, options?: PageTypeParams["options"]): Promise<void>;
    keyPress(key: string, options?: PageKeyPressParams["options"]): Promise<void>;
    evaluate<R = unknown, Arg = unknown>(expression: string | ((arg: Arg) => R | Promise<R>), arg?: Arg): Promise<R>;
    addInitScript<Arg = unknown>(script: InitScriptSource<Arg>, arg?: Arg): Promise<void>;
    setExtraHTTPHeaders(headers: PageSetExtraHTTPHeadersParams["headers"]): Promise<void>;
    setViewportSize(width: number, height: number, options?: PageSetViewportSizeParams["options"]): Promise<void>;
    waitForLoadState(state: LoadState, timeout?: number): Promise<void>;
    waitForTimeout(ms: PageWaitForTimeoutParams["ms"]): Promise<void>;
    waitForSelector(selector: string, options?: PageWaitForSelectorParams["options"]): Promise<boolean>;
    screenshot(options?: ScreenshotOptions): Promise<Buffer>;
    snapshot(options?: PageSnapshotOptions): Promise<SnapshotResult>;
    url(): Promise<string>;
    title(): Promise<string>;
    close(): Promise<void>;
    locator(selector: string): Locator;
}
