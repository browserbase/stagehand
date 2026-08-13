import type {
  ContextClearCookiesParams,
  ContextNewPageParams,
  ContextSetExtraHTTPHeadersParams,
  Cookie,
  CookieParam,
  DomainPolicy,
} from "../../protocol/types.js";
import type * as ProtocolTypes from "../../protocol/types.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import { BrowserClipboard } from "./browserClipboard.js";
import { Page } from "./page.js";
import { normalizeInitScriptSource, type InitScriptSource } from "./pageScripts.js";
import type { StagehandCommandClient } from "./commandClient.js";
export type { Cookie, CookieParam, DomainPolicy } from "../../protocol/types.js";

export type ClearCookieOptions = {
  name?: string | RegExp;
  domain?: string | RegExp;
  path?: string | RegExp;
};

/**
 * Playwright-compatible storage state. Cookies are exported via CDP (including
 * HttpOnly). `origins` is reserved for future localStorage support and is always
 * empty on export today.
 */
export type StorageState = {
  cookies: Cookie[];
  origins: StorageStateOrigin[];
};

export type StorageStateOrigin = {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
};

export type StorageStateOptions = {
  /** When set, also write the storage state JSON to this path. */
  path?: string;
};

export class BrowserContext {
  clipboardRef?: BrowserClipboard;

  constructor(readonly rpcClient: StagehandCommandClient) {}

  get clipboard(): BrowserClipboard {
    return (this.clipboardRef ??= new BrowserClipboard(this.rpcClient));
  }

  async pages(): Promise<Page[]> {
    const pageRefs = await this.rpcClient.send(StagehandMethods.contextPages, {});
    return pageRefs.map((pageRef) => new Page(this.rpcClient, pageRef));
  }

  async newPage(url?: string): Promise<Page> {
    const params: ContextNewPageParams = url === undefined ? {} : { url };
    const pageRef = await this.rpcClient.send(StagehandMethods.contextNewPage, params);
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
    return await this.rpcClient.send(StagehandMethods.contextGetDomainPolicy, {});
  }

  async setDomainPolicy(policy: DomainPolicy | null): Promise<void> {
    await this.rpcClient.send(StagehandMethods.contextSetDomainPolicy, { policy });
  }

  async cookies(urls?: string | string[]): Promise<Cookie[]> {
    const params = urls === undefined ? {} : { urls };
    return await this.rpcClient.send(StagehandMethods.contextCookies, params);
  }

  async addCookies(cookies: CookieParam[]): Promise<void> {
    await this.rpcClient.send(StagehandMethods.contextAddCookies, { cookies });
  }

  async clearCookies(options?: ClearCookieOptions): Promise<void> {
    const params: ContextClearCookiesParams =
      options === undefined ? {} : { options: serializeClearCookieOptions(options) };
    await this.rpcClient.send(StagehandMethods.contextClearCookies, params);
  }

  /**
   * Export cookies for the context in a Playwright-compatible storage state shape.
   * localStorage / IndexedDB are not included yet (`origins` is always `[]`).
   */
  async storageState(options?: StorageStateOptions): Promise<StorageState> {
    const cookies = await this.cookies();
    const state: StorageState = { cookies, origins: [] };
    if (options?.path !== undefined) {
      await writeStorageStateFile(options.path, state);
    }
    return state;
  }

  /**
   * Replace cookies in this context with those from a storage state object or JSON file.
   * Clears existing cookies first. `origins` / localStorage entries are ignored for now.
   */
  async setStorageState(state: StorageState | string): Promise<void> {
    const resolved = typeof state === "string" ? await readStorageStateFile(state) : state;
    const cookies = normalizeStorageState(resolved).cookies;
    await this.clearCookies();
    if (cookies.length === 0) return;
    await this.addCookies(cookies.map(cookieToParam));
  }
}

function serializeClearCookieOptions(
  options: ClearCookieOptions,
): ProtocolTypes.ClearCookieOptions {
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

function cookieToParam(cookie: Cookie): CookieParam {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
  };
}

function normalizeStorageState(value: unknown): StorageState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("storage state must be an object with a cookies array");
  }
  const cookiesValue = (value as { cookies?: unknown }).cookies;
  if (!Array.isArray(cookiesValue)) {
    throw new TypeError("storage state must include a cookies array");
  }
  const cookies = cookiesValue.map((entry, index) => normalizeStorageCookie(entry, index));
  const originsValue = (value as { origins?: unknown }).origins;
  const origins = Array.isArray(originsValue)
    ? originsValue.map((entry, index) => normalizeStorageOrigin(entry, index))
    : [];
  return { cookies, origins };
}

function normalizeStorageCookie(value: unknown, index: number): Cookie {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`storage state cookies[${index}] must be an object`);
  }
  const record = value as Record<string, unknown>;
  const sameSite = record.sameSite ?? record.same_site;
  if (
    typeof record.name !== "string" ||
    typeof record.value !== "string" ||
    typeof record.domain !== "string" ||
    typeof record.path !== "string" ||
    typeof record.expires !== "number" ||
    typeof (record.httpOnly ?? record.http_only) !== "boolean" ||
    typeof record.secure !== "boolean" ||
    (sameSite !== "Strict" && sameSite !== "Lax" && sameSite !== "None")
  ) {
    throw new TypeError(`storage state cookies[${index}] has an invalid shape`);
  }
  return {
    name: record.name,
    value: record.value,
    domain: record.domain,
    path: record.path,
    expires: record.expires,
    httpOnly: Boolean(record.httpOnly ?? record.http_only),
    secure: record.secure,
    sameSite,
  };
}

function normalizeStorageOrigin(value: unknown, index: number): StorageStateOrigin {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`storage state origins[${index}] must be an object`);
  }
  const record = value as { origin?: unknown; localStorage?: unknown };
  if (typeof record.origin !== "string" || !Array.isArray(record.localStorage)) {
    throw new TypeError(`storage state origins[${index}] has an invalid shape`);
  }
  return {
    origin: record.origin,
    localStorage: record.localStorage.map((entry, entryIndex) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new TypeError(
          `storage state origins[${index}].localStorage[${entryIndex}] must be an object`,
        );
      }
      const item = entry as { name?: unknown; value?: unknown };
      if (typeof item.name !== "string" || typeof item.value !== "string") {
        throw new TypeError(
          `storage state origins[${index}].localStorage[${entryIndex}] has an invalid shape`,
        );
      }
      return { name: item.name, value: item.value };
    }),
  };
}

async function writeStorageStateFile(path: string, state: StorageState): Promise<void> {
  const moduleName = "node:" + "fs/promises";
  const { writeFile } = (await import(/* @vite-ignore */ moduleName).catch(() => {
    throw new TypeError(
      "context.storageState(): path is only supported in Node.js; omit path to receive the state object",
    );
  })) as typeof import("node:fs/promises");
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function readStorageStateFile(path: string): Promise<StorageState> {
  const moduleName = "node:" + "fs/promises";
  const { readFile } = (await import(/* @vite-ignore */ moduleName).catch(() => {
    throw new TypeError(
      "context.setStorageState(): path is only supported in Node.js; pass a storage state object instead",
    );
  })) as typeof import("node:fs/promises");
  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new TypeError(
      `context.setStorageState(): failed to parse JSON from ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return normalizeStorageState(parsed);
}
