import path from "node:path";
import { pathToFileURL } from "node:url";
export { STAGEHAND_V4_SDK_PATH_ENV, resolveV4SdkPath } from "./v4CodeConfig.js";

type UnknownRecord = Record<string, unknown>;
type UnknownMethod = (...args: unknown[]) => unknown;

export type V4SdkModuleImporter = (
  specifier: string,
) => Promise<Record<string, unknown>>;

export interface V4DeterministicLocatorFacade {
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
  first(): V4DeterministicLocatorFacade;
  nth(index: number): V4DeterministicLocatorFacade;
}

export interface V4DeterministicPageFacade {
  readonly pageId: string;
  goto(...args: unknown[]): Promise<V4DeterministicPageFacade>;
  reload(...args: unknown[]): Promise<V4DeterministicPageFacade>;
  goBack(...args: unknown[]): Promise<V4DeterministicPageFacade>;
  goForward(...args: unknown[]): Promise<V4DeterministicPageFacade>;
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
  url(...args: unknown[]): Promise<unknown>;
  title(...args: unknown[]): Promise<unknown>;
  close(...args: unknown[]): Promise<unknown>;
  locator(selector: string): V4DeterministicLocatorFacade;
}

export interface V4DeterministicContextFacade {
  readonly clipboard: V4DeterministicClipboardFacade;
  pages(): Promise<V4DeterministicPageFacade[]>;
  newPage(...args: unknown[]): Promise<V4DeterministicPageFacade>;
  activePage(): Promise<V4DeterministicPageFacade | undefined>;
  setActivePage(page: V4DeterministicPageFacade): Promise<void>;
  addInitScript(...args: unknown[]): Promise<unknown>;
  setExtraHTTPHeaders(...args: unknown[]): Promise<unknown>;
  getDomainPolicy(...args: unknown[]): Promise<unknown>;
  setDomainPolicy(...args: unknown[]): Promise<unknown>;
  cookies(...args: unknown[]): Promise<unknown>;
  addCookies(...args: unknown[]): Promise<unknown>;
  clearCookies(...args: unknown[]): Promise<unknown>;
}

export interface V4DeterministicClipboardFacade {
  readText(options?: unknown): Promise<unknown>;
  writeText(text: string, options?: unknown): Promise<unknown>;
  clear(options?: unknown): Promise<unknown>;
  paste(options?: unknown): Promise<unknown>;
  copy(options?: unknown): Promise<unknown>;
  cut(options?: unknown): Promise<unknown>;
}

export interface V4DeterministicRuntime {
  page: V4DeterministicPageFacade;
  context: V4DeterministicContextFacade;
  close(): Promise<void>;
}

type V4StagehandInstance = {
  context: unknown;
  init(): Promise<unknown>;
  close(): Promise<unknown>;
};

type V4StagehandConstructor = new (options: {
  browser: { type: "local"; headless: true; userDataDir?: string };
}) => V4StagehandInstance;

export async function loadV4StagehandConstructor(
  sdkPath: string,
  importModule: V4SdkModuleImporter = defaultV4SdkImporter,
): Promise<V4StagehandConstructor> {
  const specifier = pathToFileURL(path.resolve(sdkPath)).href;
  const sdk = await importModule(specifier);
  if (typeof sdk.Stagehand !== "function") {
    throw new Error(
      `V4 SDK module at ${sdkPath} does not export a Stagehand constructor.`,
    );
  }
  return sdk.Stagehand as V4StagehandConstructor;
}

export async function initializeV4DeterministicRuntime(input: {
  sdkPath: string;
  userDataDir?: string;
  importModule?: V4SdkModuleImporter;
}): Promise<V4DeterministicRuntime> {
  const Stagehand = await loadV4StagehandConstructor(
    input.sdkPath,
    input.importModule,
  );
  const stagehand = new Stagehand({
    browser: {
      type: "local",
      headless: true,
      ...(input.userDataDir && { userDataDir: input.userDataDir }),
    },
  });
  let closePromise: Promise<void> | undefined;

  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      await stagehand.close();
    })();
    return closePromise;
  };

  try {
    await stagehand.init();
    const { context } = createV4DeterministicFacades(stagehand.context);
    const page =
      (await context.activePage()) ??
      (await context.pages())[0] ??
      (await context.newPage());
    return { page, context, close };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "V4 initialization failed and cleanup also failed.",
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

export function createV4DeterministicFacades(rawContext: unknown): {
  context: V4DeterministicContextFacade;
  wrapPage: (rawPage: unknown) => V4DeterministicPageFacade;
} {
  const contextTarget = requireObject(rawContext, "V4 browser context");
  const pagesByRaw = new WeakMap<object, V4DeterministicPageFacade>();
  const rawPagesByFacade = new WeakMap<object, object>();
  const locatorsByRaw = new WeakMap<object, V4DeterministicLocatorFacade>();
  const rawLocatorsByFacade = new WeakMap<object, object>();

  const wrapLocator = (rawLocator: unknown): V4DeterministicLocatorFacade => {
    const locatorTarget = requireObject(rawLocator, "V4 locator");
    const existing = locatorsByRaw.get(locatorTarget);
    if (existing) return existing;

    const facade: V4DeterministicLocatorFacade = {
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
      sendClickEvent: (...args) =>
        invoke(locatorTarget, "sendClickEvent", args),
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

  const wrapPage = (rawPage: unknown): V4DeterministicPageFacade => {
    const pageTarget = requireObject(rawPage, "V4 page");
    const existing = pagesByRaw.get(pageTarget);
    if (existing) return existing;

    const facade: V4DeterministicPageFacade = {
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
      setExtraHTTPHeaders: (...args) =>
        invoke(pageTarget, "setExtraHTTPHeaders", args),
      setViewportSize: (...args) => invoke(pageTarget, "setViewportSize", args),
      waitForLoadState: (...args) =>
        invoke(pageTarget, "waitForLoadState", args),
      waitForTimeout: (...args) => invoke(pageTarget, "waitForTimeout", args),
      waitForSelector: (...args) => invoke(pageTarget, "waitForSelector", args),
      screenshot: (...args) =>
        invoke(pageTarget, "screenshot", unwrapScreenshotArgs(args)),
      snapshot: (...args) => invoke(pageTarget, "snapshot", args),
      url: (...args) => invoke(pageTarget, "url", args),
      title: (...args) => invoke(pageTarget, "title", args),
      close: (...args) => invoke(pageTarget, "close", args),
      locator: (selector) =>
        wrapLocator(invokeSync(pageTarget, "locator", [selector])),
    };

    Object.freeze(facade);
    pagesByRaw.set(pageTarget, facade);
    rawPagesByFacade.set(facade, pageTarget);
    return facade;
  };

  const clipboardTarget = requireObject(
    contextTarget.clipboard,
    "V4 browser clipboard",
  );
  const clipboard: V4DeterministicClipboardFacade = {
    readText: (options) =>
      invoke(clipboardTarget, "readText", [unwrapClipboardOptions(options)]),
    writeText: (text, options) =>
      invoke(clipboardTarget, "writeText", [
        text,
        unwrapClipboardOptions(options),
      ]),
    clear: (options) =>
      invoke(clipboardTarget, "clear", [unwrapClipboardOptions(options)]),
    paste: (options) =>
      invoke(clipboardTarget, "paste", [unwrapClipboardOptions(options)]),
    copy: (options) =>
      invoke(clipboardTarget, "copy", [unwrapClipboardOptions(options)]),
    cut: (options) =>
      invoke(clipboardTarget, "cut", [unwrapClipboardOptions(options)]),
  };
  Object.freeze(clipboard);

  const context: V4DeterministicContextFacade = {
    clipboard,
    pages: async () => {
      const pages = await invoke(contextTarget, "pages", []);
      if (!Array.isArray(pages)) {
        throw new Error("V4 context.pages() did not return an array.");
      }
      return pages.map(wrapPage);
    },
    newPage: async (...args) =>
      wrapPage(await invoke(contextTarget, "newPage", args)),
    activePage: async () => {
      const active = await invoke(contextTarget, "activePage", []);
      return active === undefined || active === null
        ? undefined
        : wrapPage(active);
    },
    setActivePage: async (page) => {
      const rawPage = rawPagesByFacade.get(page);
      if (!rawPage) {
        throw new Error(
          "context.setActivePage() requires a page returned by this deterministic V4 context.",
        );
      }
      await invoke(contextTarget, "setActivePage", [rawPage]);
    },
    addInitScript: (...args) => invoke(contextTarget, "addInitScript", args),
    setExtraHTTPHeaders: (...args) =>
      invoke(contextTarget, "setExtraHTTPHeaders", args),
    getDomainPolicy: (...args) =>
      invoke(contextTarget, "getDomainPolicy", args),
    setDomainPolicy: (...args) =>
      invoke(contextTarget, "setDomainPolicy", args),
    cookies: (...args) => invoke(contextTarget, "cookies", args),
    addCookies: (...args) => invoke(contextTarget, "addCookies", args),
    clearCookies: (...args) => invoke(contextTarget, "clearCookies", args),
  };
  Object.freeze(context);

  function unwrapClipboardOptions(options: unknown): unknown {
    if (!isRecord(options) || options.page === undefined) return options;
    if (!isObject(options.page)) {
      throw new Error("clipboard page must be a V4 page facade.");
    }
    const rawPage = rawPagesByFacade.get(options.page);
    if (!rawPage) {
      throw new Error(
        "clipboard page must come from this deterministic V4 context.",
      );
    }
    return { ...options, page: rawPage };
  }

  function unwrapScreenshotArgs(args: unknown[]): unknown[] {
    const [options, ...rest] = args;
    if (!isRecord(options) || !Array.isArray(options.mask)) return args;
    const mask = options.mask.map((locator) => {
      if (!isObject(locator)) {
        throw new Error("screenshot mask entries must be V4 locator facades.");
      }
      const rawLocator = rawLocatorsByFacade.get(locator);
      if (!rawLocator) {
        throw new Error("screenshot mask entries must come from this V4 page.");
      }
      return rawLocator;
    });
    return [{ ...options, mask }, ...rest];
  }

  return { context, wrapPage };
}

export async function executeV4DeterministicSnippet(input: {
  code: string;
  runtime: Pick<V4DeterministicRuntime, "page" | "context">;
  startUrl: string;
  task: Record<string, unknown>;
  console: Pick<Console, "log" | "warn" | "error">;
}): Promise<unknown> {
  const AsyncFunction = Object.getPrototypeOf(async function () {})
    .constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<unknown>;
  const fn = new AsyncFunction(
    "page",
    "context",
    "startUrl",
    "task",
    "console",
    input.code,
  );
  return fn(
    input.runtime.page,
    input.runtime.context,
    input.startUrl,
    input.task,
    input.console,
  );
}

async function defaultV4SdkImporter(
  specifier: string,
): Promise<Record<string, unknown>> {
  return (await import(specifier)) as Record<string, unknown>;
}

function requireObject(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new Error(`${label} is not an object.`);
  }
  return value;
}

function invoke(
  target: UnknownRecord,
  methodName: string,
  args: unknown[],
): Promise<unknown> {
  return Promise.resolve(invokeSync(target, methodName, args));
}

function invokeSync(
  target: UnknownRecord,
  methodName: string,
  args: unknown[],
): unknown {
  const method = target[methodName];
  if (typeof method !== "function") {
    throw new Error(`V4 runtime does not implement ${methodName}().`);
  }
  return Reflect.apply(method as UnknownMethod, target, args);
}

function readString(target: UnknownRecord, key: string): string {
  const value = target[key];
  if (typeof value !== "string") {
    throw new Error(`V4 runtime ${key} is not a string.`);
  }
  return value;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return isObject(value);
}
