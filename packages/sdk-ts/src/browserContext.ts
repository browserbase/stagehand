import type {
  ContextClearCookiesParams,
  ContextNewPageParams,
  ContextSetExtraHTTPHeadersParams,
  Cookie,
  CookieParam,
  DomainPolicy,
} from "../../protocol/types.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import { BrowserClipboard } from "./browserClipboard.js";
import { Page } from "./page.js";
import { normalizeInitScriptSource, type InitScriptSource } from "./pageScripts.js";
import type { RPCClient } from "./rpcClient.js";
export type { Cookie, CookieParam, DomainPolicy } from "../../protocol/types.js";

export type ClearCookieOptions = {
  name?: string | RegExp;
  domain?: string | RegExp;
  path?: string | RegExp;
};

export class BrowserContext {
  clipboardRef?: BrowserClipboard;

  constructor(readonly rpcClient: RPCClient) {}

  get clipboard(): BrowserClipboard {
    return (this.clipboardRef ??= new BrowserClipboard(this.rpcClient));
  }

  async pages(): Promise<Page[]> {
    const pageRefs = await this.rpcClient.send(StagehandMethods.contextPages, {});
    return pageRefs.map((pageRef) => new Page(this.rpcClient, pageRef));
  }

  async newPage(options: ContextNewPageParams = {}): Promise<Page> {
    const pageRef = await this.rpcClient.send(StagehandMethods.contextNewPage, options);
    return new Page(this.rpcClient, pageRef);
  }

  async activePage(): Promise<Page | undefined> {
    const pageRef = await this.rpcClient.send(StagehandMethods.contextActivePage, {});
    return pageRef ? new Page(this.rpcClient, pageRef) : undefined;
  }

  async setActivePage(page: Page): Promise<void> {
    await this.rpcClient.send(StagehandMethods.contextSetActivePage, {
      pageId: page.pageId,
    });
  }

  /** Close the remote context. Call Stagehand.close() to dispose the SDK's local resources. */
  async close(): Promise<void> {
    await this.rpcClient.send(StagehandMethods.contextClose, {});
  }

  async addInitScript<Arg = unknown>(script: InitScriptSource<Arg>, arg?: Arg): Promise<void> {
    const source = await normalizeInitScriptSource(script, arg, "context.addInitScript");
    await this.rpcClient.send(StagehandMethods.contextAddInitScript, { source });
  }

  async setExtraHTTPHeaders(headers: ContextSetExtraHTTPHeadersParams["headers"]): Promise<void> {
    await this.rpcClient.send(StagehandMethods.contextSetExtraHTTPHeaders, { headers });
  }

  async getDomainPolicy(): Promise<DomainPolicy | null> {
    const { policy } = await this.rpcClient.send(StagehandMethods.contextGetDomainPolicy, {});
    return policy;
  }

  async setDomainPolicy(policy: DomainPolicy | null): Promise<void> {
    await this.rpcClient.send(StagehandMethods.contextSetDomainPolicy, { policy });
  }

  async cookies(urls?: string | string[]): Promise<Cookie[]> {
    const params = urls === undefined ? {} : { urls };
    const { cookies } = await this.rpcClient.send(StagehandMethods.contextCookies, params);
    return cookies;
  }

  async addCookies(cookies: CookieParam[]): Promise<void> {
    await this.rpcClient.send(StagehandMethods.contextAddCookies, { cookies });
  }

  async clearCookies(options?: ClearCookieOptions): Promise<void> {
    const params: ContextClearCookiesParams =
      options === undefined ? {} : { options: serializeClearCookieOptions(options) };
    await this.rpcClient.send(StagehandMethods.contextClearCookies, params);
  }
}

function serializeClearCookieOptions(
  options: ClearCookieOptions,
): NonNullable<ContextClearCookiesParams["options"]> {
  return {
    ...(options.name === undefined ? {} : { name: serializeCookieFilter(options.name) }),
    ...(options.domain === undefined ? {} : { domain: serializeCookieFilter(options.domain) }),
    ...(options.path === undefined ? {} : { path: serializeCookieFilter(options.path) }),
  };
}

function serializeCookieFilter(
  filter: string | RegExp,
): string | { source: string; flags: string } {
  return typeof filter === "string" ? filter : { source: filter.source, flags: filter.flags };
}
