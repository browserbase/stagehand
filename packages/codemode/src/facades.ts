import type { z } from "zod/v4";

type UnknownRecord = Record<string, unknown>;
type UnknownMethod = (...args: unknown[]) => unknown;

export interface CodeLocatorFacade {
  click(...args: unknown[]): Promise<unknown>;
  hover(...args: unknown[]): Promise<unknown>;
  fill(...args: unknown[]): Promise<unknown>;
  count(...args: unknown[]): Promise<unknown>;
  isChecked(...args: unknown[]): Promise<unknown>;
  inputValue(...args: unknown[]): Promise<unknown>;
  isVisible(...args: unknown[]): Promise<unknown>;
  innerText(...args: unknown[]): Promise<unknown>;
  innerHtml(...args: unknown[]): Promise<unknown>;
  textContent(...args: unknown[]): Promise<unknown>;
  scrollTo(...args: unknown[]): Promise<unknown>;
  centroid(...args: unknown[]): Promise<unknown>;
  highlight(...args: unknown[]): Promise<unknown>;
  sendClickEvent(...args: unknown[]): Promise<unknown>;
  type(...args: unknown[]): Promise<unknown>;
  selectOption(...args: unknown[]): Promise<unknown>;
  first(): CodeLocatorFacade;
  nth(index: number): CodeLocatorFacade;
}

export interface CodePageFacade {
  readonly pageId: string;
  goto(...args: unknown[]): Promise<CodePageFacade>;
  reload(...args: unknown[]): Promise<CodePageFacade>;
  goBack(...args: unknown[]): Promise<CodePageFacade>;
  goForward(...args: unknown[]): Promise<CodePageFacade>;
  click(...args: unknown[]): Promise<unknown>;
  hover(...args: unknown[]): Promise<unknown>;
  scroll(...args: unknown[]): Promise<unknown>;
  dragAndDrop(...args: unknown[]): Promise<unknown>;
  type(...args: unknown[]): Promise<unknown>;
  keyPress(...args: unknown[]): Promise<unknown>;
  evaluate(...args: unknown[]): Promise<unknown>;
  addInitScript(...args: unknown[]): Promise<unknown>;
  setExtraHTTPHeaders(...args: unknown[]): Promise<unknown>;
  setViewportSize(...args: unknown[]): Promise<unknown>;
  waitForLoadState(...args: unknown[]): Promise<unknown>;
  waitForTimeout(...args: unknown[]): Promise<unknown>;
  waitForSelector(...args: unknown[]): Promise<unknown>;
  screenshot(...args: unknown[]): Promise<unknown>;
  snapshot(...args: unknown[]): Promise<unknown>;
  url(): Promise<string>;
  title(): Promise<string>;
  close(): Promise<void>;
  locator(selector: string): CodeLocatorFacade;
}

export interface CodeClipboardFacade {
  readText(options?: unknown): Promise<unknown>;
  writeText(text: string, options?: unknown): Promise<unknown>;
  clear(options?: unknown): Promise<unknown>;
  paste(options?: unknown): Promise<unknown>;
  copy(options?: unknown): Promise<unknown>;
  cut(options?: unknown): Promise<unknown>;
}

export interface CodeContextFacade {
  readonly clipboard: CodeClipboardFacade;
  pages(): Promise<CodePageFacade[]>;
  newPage(...args: unknown[]): Promise<CodePageFacade>;
  activePage(): Promise<CodePageFacade | undefined>;
  setActivePage(page: CodePageFacade): Promise<void>;
  addInitScript(...args: unknown[]): Promise<unknown>;
  setExtraHTTPHeaders(...args: unknown[]): Promise<unknown>;
  getDomainPolicy(...args: unknown[]): Promise<unknown>;
  setDomainPolicy(...args: unknown[]): Promise<unknown>;
  cookies(...args: unknown[]): Promise<unknown>;
  addCookies(...args: unknown[]): Promise<unknown>;
  clearCookies(...args: unknown[]): Promise<unknown>;
}

export interface CodeStagehandFacade {
  act(instruction: unknown, options?: Record<string, unknown>): Promise<unknown>;
  observe(instruction?: string, options?: Record<string, unknown>): Promise<unknown>;
  extract(
    instruction: string,
    schema: z.ZodType,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

export type CodeFacades = {
  context: CodeContextFacade;
  wrapPage: (rawPage: unknown) => CodePageFacade;
  stagehand: CodeStagehandFacade;
};

export function createCodeFacades(rawStagehand: unknown, rawContext: unknown): CodeFacades {
  const stagehandTarget = requireObject(rawStagehand, "Stagehand instance");
  const contextTarget = requireObject(rawContext, "Stagehand browser context");
  const pagesByRaw = new WeakMap<object, CodePageFacade>();
  const rawPagesByFacade = new WeakMap<object, object>();
  const locatorsByRaw = new WeakMap<object, CodeLocatorFacade>();
  const rawLocatorsByFacade = new WeakMap<object, object>();

  const wrapLocator = (rawLocator: unknown): CodeLocatorFacade => {
    const locatorTarget = requireObject(rawLocator, "Stagehand locator");
    const existing = locatorsByRaw.get(locatorTarget);
    if (existing) return existing;

    const facade: CodeLocatorFacade = {
      click: (...args) => invoke(locatorTarget, "click", args),
      hover: (...args) => invoke(locatorTarget, "hover", args),
      fill: (...args) => invoke(locatorTarget, "fill", args),
      count: (...args) => invoke(locatorTarget, "count", args),
      isChecked: (...args) => invoke(locatorTarget, "isChecked", args),
      inputValue: (...args) => invoke(locatorTarget, "inputValue", args),
      isVisible: (...args) => invoke(locatorTarget, "isVisible", args),
      innerText: (...args) => invoke(locatorTarget, "innerText", args),
      innerHtml: (...args) => invoke(locatorTarget, "innerHtml", args),
      textContent: (...args) => invoke(locatorTarget, "textContent", args),
      scrollTo: (...args) => invoke(locatorTarget, "scrollTo", args),
      centroid: (...args) => invoke(locatorTarget, "centroid", args),
      highlight: (...args) => invoke(locatorTarget, "highlight", args),
      sendClickEvent: (...args) => invoke(locatorTarget, "sendClickEvent", args),
      type: (...args) => invoke(locatorTarget, "type", args),
      selectOption: (...args) => invoke(locatorTarget, "selectOption", args),
      first: () => wrapLocator(invokeSync(locatorTarget, "first", [])),
      nth: (index) => wrapLocator(invokeSync(locatorTarget, "nth", [index])),
    };

    Object.freeze(facade);
    locatorsByRaw.set(locatorTarget, facade);
    rawLocatorsByFacade.set(facade, locatorTarget);
    return facade;
  };

  const wrapPage = (rawPage: unknown): CodePageFacade => {
    const pageTarget = requireObject(rawPage, "Stagehand page");
    const existing = pagesByRaw.get(pageTarget);
    if (existing) return existing;

    const facade: CodePageFacade = {
      pageId: readString(pageTarget, "pageId"),
      goto: async (...args) => {
        await invoke(pageTarget, "goto", args);
        return facade;
      },
      reload: async (...args) => {
        await invoke(pageTarget, "reload", args);
        return facade;
      },
      goBack: async (...args) => {
        await invoke(pageTarget, "goBack", args);
        return facade;
      },
      goForward: async (...args) => {
        await invoke(pageTarget, "goForward", args);
        return facade;
      },
      click: (...args) => invoke(pageTarget, "click", args),
      hover: (...args) => invoke(pageTarget, "hover", args),
      scroll: (...args) => invoke(pageTarget, "scroll", args),
      dragAndDrop: (...args) => invoke(pageTarget, "dragAndDrop", args),
      type: (...args) => invoke(pageTarget, "type", args),
      keyPress: (...args) => invoke(pageTarget, "keyPress", args),
      evaluate: (...args) => invoke(pageTarget, "evaluate", args),
      addInitScript: (...args) => invoke(pageTarget, "addInitScript", args),
      setExtraHTTPHeaders: (...args) => invoke(pageTarget, "setExtraHTTPHeaders", args),
      setViewportSize: (...args) => invoke(pageTarget, "setViewportSize", args),
      waitForLoadState: (...args) => invoke(pageTarget, "waitForLoadState", args),
      waitForTimeout: (...args) => invoke(pageTarget, "waitForTimeout", args),
      waitForSelector: (...args) => invoke(pageTarget, "waitForSelector", args),
      screenshot: (...args) => invoke(pageTarget, "screenshot", unwrapScreenshotArgs(args)),
      snapshot: (...args) => invoke(pageTarget, "snapshot", args),
      url: () => invoke(pageTarget, "url", []) as Promise<string>,
      title: () => invoke(pageTarget, "title", []) as Promise<string>,
      close: () => invoke(pageTarget, "close", []) as Promise<void>,
      locator: (selector) => wrapLocator(invokeSync(pageTarget, "locator", [selector])),
    };

    Object.freeze(facade);
    pagesByRaw.set(pageTarget, facade);
    rawPagesByFacade.set(facade, pageTarget);
    return facade;
  };

  const clipboardTarget = requireObject(contextTarget.clipboard, "Stagehand browser clipboard");
  const clipboard: CodeClipboardFacade = Object.freeze({
    readText: (options?: unknown) =>
      invoke(clipboardTarget, "readText", [unwrapPageOption(options)]),
    writeText: (text: string, options?: unknown) =>
      invoke(clipboardTarget, "writeText", [text, unwrapPageOption(options)]),
    clear: (options?: unknown) => invoke(clipboardTarget, "clear", [unwrapPageOption(options)]),
    paste: (options?: unknown) => invoke(clipboardTarget, "paste", [unwrapPageOption(options)]),
    copy: (options?: unknown) => invoke(clipboardTarget, "copy", [unwrapPageOption(options)]),
    cut: (options?: unknown) => invoke(clipboardTarget, "cut", [unwrapPageOption(options)]),
  });

  const context: CodeContextFacade = Object.freeze({
    clipboard,
    pages: async () => requireArray(await invoke(contextTarget, "pages", [])).map(wrapPage),
    newPage: async (...args: unknown[]) => wrapPage(await invoke(contextTarget, "newPage", args)),
    activePage: async () => {
      const active = await invoke(contextTarget, "activePage", []);
      return active === undefined || active === null ? undefined : wrapPage(active);
    },
    setActivePage: async (page: CodePageFacade) => {
      await invoke(contextTarget, "setActivePage", [
        requireOwnedPage(page, rawPagesByFacade, "context.setActivePage"),
      ]);
    },
    addInitScript: (...args: unknown[]) => invoke(contextTarget, "addInitScript", args),
    setExtraHTTPHeaders: (...args: unknown[]) => invoke(contextTarget, "setExtraHTTPHeaders", args),
    getDomainPolicy: (...args: unknown[]) => invoke(contextTarget, "getDomainPolicy", args),
    setDomainPolicy: (...args: unknown[]) => invoke(contextTarget, "setDomainPolicy", args),
    cookies: (...args: unknown[]) => invoke(contextTarget, "cookies", args),
    addCookies: (...args: unknown[]) => invoke(contextTarget, "addCookies", args),
    clearCookies: (...args: unknown[]) => invoke(contextTarget, "clearCookies", args),
  });

  const stagehand: CodeStagehandFacade = Object.freeze({
    act: (instruction: unknown, options?: Record<string, unknown>) =>
      invoke(
        stagehandTarget,
        "act",
        options === undefined ? [instruction] : [instruction, unwrapPageOption(options)],
      ),
    observe: (instruction?: string, options?: Record<string, unknown>) =>
      invoke(
        stagehandTarget,
        "observe",
        options === undefined
          ? instruction === undefined
            ? []
            : [instruction]
          : [instruction, unwrapPageOption(options)],
      ),
    extract: (instruction: string, schema: z.ZodType, options?: Record<string, unknown>) =>
      invoke(
        stagehandTarget,
        "extract",
        options === undefined
          ? [instruction, schema]
          : [instruction, schema, unwrapPageOption(options)],
      ),
  });

  return { context, wrapPage, stagehand };

  function unwrapPageOption(options: unknown): unknown {
    if (!isRecord(options) || options.page === undefined) return options;
    return {
      ...options,
      page: requireOwnedPage(options.page, rawPagesByFacade, "page option"),
    };
  }

  function unwrapScreenshotArgs(args: unknown[]): unknown[] {
    const [options, ...rest] = args;
    if (!isRecord(options) || !Array.isArray(options.mask)) return args;
    const mask = options.mask.map((locator) => {
      if (!isObject(locator)) {
        throw new Error("screenshot mask entries must be Stagehand locator facades.");
      }
      const rawLocator = rawLocatorsByFacade.get(locator);
      if (!rawLocator) {
        throw new Error("screenshot mask entries must come from this code session.");
      }
      return rawLocator;
    });
    return [{ ...options, mask }, ...rest];
  }
}

function invoke(target: UnknownRecord, methodName: string, args: unknown[]): Promise<unknown> {
  const method = target[methodName];
  if (typeof method !== "function") {
    throw new Error(`Stagehand object does not expose ${methodName}().`);
  }
  return Promise.resolve((method as UnknownMethod).apply(target, args));
}

function invokeSync(target: UnknownRecord, methodName: string, args: unknown[]): unknown {
  const method = target[methodName];
  if (typeof method !== "function") {
    throw new Error(`Stagehand object does not expose ${methodName}().`);
  }
  return (method as UnknownMethod).apply(target, args);
}

function requireObject(value: unknown, label: string): UnknownRecord {
  if (!isObject(value)) throw new Error(`${label} is not an object.`);
  return value as UnknownRecord;
}

function requireArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("Stagehand context.pages() did not return an array.");
  }
  return value;
}

function requireOwnedPage(
  page: unknown,
  rawPagesByFacade: WeakMap<object, object>,
  label: string,
): object {
  if (!isObject(page)) {
    throw new Error(`${label} requires a page facade from this code session.`);
  }
  const rawPage = rawPagesByFacade.get(page);
  if (!rawPage) {
    throw new Error(`${label} requires a page facade from this code session.`);
  }
  return rawPage;
}

function readString(target: UnknownRecord, key: string): string {
  const value = target[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Stagehand object is missing string property ${key}.`);
  }
  return value;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return isObject(value) && !Array.isArray(value);
}
