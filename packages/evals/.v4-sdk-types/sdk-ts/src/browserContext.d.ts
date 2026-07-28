import type { ContextNewPageParams, ContextSetExtraHTTPHeadersParams, Cookie, CookieParam, DomainPolicy } from "../../protocol/types.js";
import { BrowserClipboard } from "./browserClipboard.js";
import { Page } from "./page.js";
import { type InitScriptSource } from "./pageScripts.js";
import type { RPCClient } from "./rpcClient.js";
export type { Cookie, CookieParam, DomainPolicy } from "../../protocol/types.js";
export type ClearCookieOptions = {
    name?: string | RegExp;
    domain?: string | RegExp;
    path?: string | RegExp;
};
export declare class BrowserContext {
    readonly rpcClient: RPCClient;
    clipboardRef?: BrowserClipboard;
    constructor(rpcClient: RPCClient);
    get clipboard(): BrowserClipboard;
    pages(): Promise<Page[]>;
    newPage(options?: ContextNewPageParams): Promise<Page>;
    activePage(): Promise<Page | undefined>;
    setActivePage(page: Page): Promise<void>;
    /** Close the remote context. Call Stagehand.close() to dispose the SDK's local resources. */
    close(): Promise<void>;
    addInitScript<Arg = unknown>(script: InitScriptSource<Arg>, arg?: Arg): Promise<void>;
    setExtraHTTPHeaders(headers: ContextSetExtraHTTPHeadersParams["headers"]): Promise<void>;
    getDomainPolicy(): Promise<DomainPolicy | null>;
    setDomainPolicy(policy: DomainPolicy | null): Promise<void>;
    cookies(urls?: string | string[]): Promise<Cookie[]>;
    addCookies(cookies: CookieParam[]): Promise<void>;
    clearCookies(options?: ClearCookieOptions): Promise<void>;
}
