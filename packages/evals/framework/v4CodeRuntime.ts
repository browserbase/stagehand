import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod/v4";
import type {
  V4CodeBrowserbaseResources,
  V4CodeBrowserConfig,
  V4CodeMode,
  V4CodeModelConfig,
} from "./v4CodeConfig.js";
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

export interface V4AiMethodOptions {
  page?: V4DeterministicPageFacade;
  [key: string]: unknown;
}

export interface V4AiStagehandFacade {
  act(instruction: string, options?: V4AiMethodOptions): Promise<unknown>;
  observe(instruction?: string, options?: V4AiMethodOptions): Promise<unknown>;
  extract(
    instruction: string,
    schema: z.ZodType,
    options?: V4AiMethodOptions,
  ): Promise<unknown>;
}

export type V4CodePageFacade = V4DeterministicPageFacade;

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

export interface V4CodeContextFacade
  extends Omit<
    V4DeterministicContextFacade,
    "pages" | "newPage" | "activePage" | "setActivePage"
  > {
  pages(): Promise<V4CodePageFacade[]>;
  newPage(...args: unknown[]): Promise<V4CodePageFacade>;
  activePage(): Promise<V4CodePageFacade | undefined>;
  setActivePage(page: V4CodePageFacade): Promise<void>;
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

export interface V4CodeRuntime {
  mode: V4CodeMode;
  page: V4CodePageFacade;
  context: V4CodeContextFacade;
  stagehand?: V4AiStagehandFacade;
  browserbaseResources?: V4CodeBrowserbaseResources;
  metrics(): Promise<V4CodeMetricsSnapshot>;
  close(): Promise<void>;
}

export interface V4CodeMetricsSnapshot {
  available: boolean;
  values: Record<string, number>;
  unavailableReason?: "not_applicable" | "upstream_not_implemented";
}

type V4StagehandInstance = {
  context: unknown;
  act(input: string, options?: unknown): Promise<unknown>;
  observe(instruction?: string, options?: unknown): Promise<unknown>;
  extract(
    instruction: string,
    schema: z.ZodType,
    options?: unknown,
  ): Promise<unknown>;
  init(): Promise<unknown>;
  metrics(): Promise<unknown>;
  close(): Promise<unknown>;
};

type V4StagehandInitOptions = {
  apiKey?: string;
  browser:
    | { type: "local"; headless: true; userDataDir?: string }
    | {
        type: "browserbase";
        region?: Extract<
          V4CodeBrowserConfig,
          { type: "browserbase" }
        >["region"];
        userMetadata: Record<string, string>;
      };
  model?: V4CodeModelConfig;
};

type V4StagehandConstructor = new (
  options: V4StagehandInitOptions,
) => V4StagehandInstance;

type V4BrowserbaseApiClient = {
  uploadExtension(archivePath: string): Promise<{ id: string }>;
  deleteExtension(extensionId: string): Promise<void>;
  createSession(
    params: Record<string, unknown>,
  ): Promise<{ id: string; connectUrl: string }>;
  releaseSession(sessionId: string): Promise<void>;
};

type V4InternalStagehandModule = {
  createStagehandWithDependenciesForTest(
    options: V4StagehandInitOptions,
    adapters: {
      resolveBrowserSource(input: unknown): Promise<unknown>;
    },
  ): V4StagehandInstance;
};

type V4InternalBrowserSourceModule = {
  resolveBrowserSource(
    input: unknown,
    dependencies: { browserbase: unknown },
  ): Promise<unknown>;
};

type V4InternalBrowserbaseSessionModule = {
  createBrowserbaseApiClient(apiKey: string): V4BrowserbaseApiClient;
  createBrowserbaseSessionClient(
    apiKey: string,
    dependencies: { browserbase: V4BrowserbaseApiClient },
  ): unknown;
};

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
  browser?: V4CodeBrowserConfig;
  importModule?: V4SdkModuleImporter;
}): Promise<V4DeterministicRuntime> {
  const runtime = await initializeV4CodeRuntime({
    ...input,
    mode: "deterministic",
  });
  return {
    page: runtime.page as V4DeterministicPageFacade,
    context: runtime.context as V4DeterministicContextFacade,
    close: runtime.close,
  };
}

export async function initializeV4CodeRuntime(input: {
  sdkPath: string;
  userDataDir?: string;
  browser?: V4CodeBrowserConfig;
  mode: V4CodeMode;
  model?: V4CodeModelConfig;
  importModule?: V4SdkModuleImporter;
  onBrowserbaseResources?: (
    resources: V4CodeBrowserbaseResources,
  ) => Promise<void> | void;
}): Promise<V4CodeRuntime> {
  const model = resolveRuntimeModel(input.mode, input.model);
  const browser = resolveRuntimeBrowser(input.browser, input.userDataDir);
  const options = buildStagehandInitOptions(browser, model, input.mode);
  const { stagehand, browserbaseResources } =
    browser.type === "browserbase"
      ? await createTrackedBrowserbaseStagehand({
          sdkPath: input.sdkPath,
          browser,
          options,
          importModule: input.importModule,
          onBrowserbaseResources: input.onBrowserbaseResources,
        })
      : {
          stagehand: new (await loadV4StagehandConstructor(
            input.sdkPath,
            input.importModule,
          ))(options),
          browserbaseResources: undefined,
        };
  let closePromise: Promise<void> | undefined;

  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      await stagehand.close();
    })();
    return closePromise;
  };
  const metrics = async (): Promise<V4CodeMetricsSnapshot> => {
    if (input.mode !== "ai") {
      return {
        available: false,
        values: {},
        unavailableReason: "not_applicable",
      };
    }
    try {
      return {
        available: true,
        values: normalizeV4StagehandMetrics(await stagehand.metrics()),
      };
    } catch (error) {
      // TODO: Remove this compatibility guard after v4-spike implements
      // stagehand.metrics in the extension runtime.
      if (isV4MetricsNotImplementedError(error)) {
        return {
          available: false,
          values: {},
          unavailableReason: "upstream_not_implemented",
        };
      }
      throw error;
    }
  };

  try {
    await stagehand.init();
    const { context, stagehand: stagehandFacade } = createV4CodeFacades(
      stagehand.context,
      input.mode,
      stagehand,
    );
    const page =
      (await context.activePage()) ??
      (await context.pages())[0] ??
      (await context.newPage());
    return {
      mode: input.mode,
      page,
      context,
      ...(stagehandFacade && { stagehand: stagehandFacade }),
      ...(browserbaseResources && { browserbaseResources }),
      metrics,
      close,
    };
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

function resolveRuntimeBrowser(
  browser: V4CodeBrowserConfig | undefined,
  userDataDir: string | undefined,
): V4CodeBrowserConfig {
  if (browser && userDataDir) {
    throw new Error(
      "V4 runtime browser configuration and legacy userDataDir cannot be provided together.",
    );
  }
  return (
    browser ?? {
      type: "local",
      ...(userDataDir && { userDataDir }),
    }
  );
}

function buildStagehandInitOptions(
  browser: V4CodeBrowserConfig,
  model: V4CodeModelConfig | undefined,
  mode: V4CodeMode,
): V4StagehandInitOptions {
  return {
    ...(browser.type === "browserbase" && { apiKey: browser.apiKey }),
    browser:
      browser.type === "local"
        ? {
            type: "local",
            headless: true,
            ...(browser.userDataDir && { userDataDir: browser.userDataDir }),
          }
        : {
            type: "browserbase",
            ...(browser.region && { region: browser.region }),
            userMetadata: {
              stagehand: "true",
              evals: "true",
              toolSurface: mode === "ai" ? "v4_code" : "v4_code_deterministic",
            },
          },
    ...(model && { model }),
  };
}

async function createTrackedBrowserbaseStagehand(input: {
  sdkPath: string;
  browser: Extract<V4CodeBrowserConfig, { type: "browserbase" }>;
  options: V4StagehandInitOptions;
  importModule?: V4SdkModuleImporter;
  onBrowserbaseResources?: (
    resources: V4CodeBrowserbaseResources,
  ) => Promise<void> | void;
}): Promise<{
  stagehand: V4StagehandInstance;
  browserbaseResources: V4CodeBrowserbaseResources;
}> {
  const importModule = input.importModule ?? defaultV4SdkImporter;
  const [stagehandModule, browserSourceModule, browserbaseSessionModule] =
    await Promise.all([
      importV4SiblingModule(input.sdkPath, "stagehand", importModule),
      importV4SiblingModule(input.sdkPath, "browserSource", importModule),
      importV4SiblingModule(input.sdkPath, "browserbaseSession", importModule),
    ]);
  const createStagehandWithDependenciesForTest = requireFunction(
    stagehandModule,
    "createStagehandWithDependenciesForTest",
  ) as V4InternalStagehandModule["createStagehandWithDependenciesForTest"];
  const resolveBrowserSource = requireFunction(
    browserSourceModule,
    "resolveBrowserSource",
  ) as V4InternalBrowserSourceModule["resolveBrowserSource"];
  const createBrowserbaseApiClient = requireFunction(
    browserbaseSessionModule,
    "createBrowserbaseApiClient",
  ) as V4InternalBrowserbaseSessionModule["createBrowserbaseApiClient"];
  const createBrowserbaseSessionClient = requireFunction(
    browserbaseSessionModule,
    "createBrowserbaseSessionClient",
  ) as V4InternalBrowserbaseSessionModule["createBrowserbaseSessionClient"];

  const resources: V4CodeBrowserbaseResources = {};
  const report = async (update: V4CodeBrowserbaseResources): Promise<void> => {
    Object.assign(resources, update);
    await input.onBrowserbaseResources?.({ ...resources });
  };
  const nativeApi = createBrowserbaseApiClient(input.browser.apiKey);
  const trackingApi: V4BrowserbaseApiClient = {
    async uploadExtension(archivePath) {
      const uploaded = await nativeApi.uploadExtension(archivePath);
      try {
        await report({ extensionId: uploaded.id.trim() });
      } catch (error) {
        try {
          await nativeApi.deleteExtension(uploaded.id);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "V4 Browserbase extension handoff failed and local cleanup also failed.",
            { cause: cleanupError },
          );
        }
        throw error;
      }
      return uploaded;
    },
    deleteExtension: (extensionId) => nativeApi.deleteExtension(extensionId),
    async createSession(params) {
      const created = await nativeApi.createSession({
        ...params,
        ...(input.browser.projectId && {
          projectId: input.browser.projectId,
        }),
      });
      try {
        await report({ sessionId: created.id.trim() });
      } catch (error) {
        try {
          await nativeApi.releaseSession(created.id);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "V4 Browserbase session handoff failed and local cleanup also failed.",
            { cause: cleanupError },
          );
        }
        throw error;
      }
      return created;
    },
    releaseSession: (sessionId) => nativeApi.releaseSession(sessionId),
  };
  const browserbase = createBrowserbaseSessionClient(input.browser.apiKey, {
    browserbase: trackingApi,
  });

  // The unpublished V4 spike has no public resource lifecycle hook. This
  // intentionally pinned internal adapter keeps native provisioning/cleanup
  // intact while letting the parent bridge supervise abnormal termination.
  const stagehand = createStagehandWithDependenciesForTest(input.options, {
    resolveBrowserSource: (params) =>
      resolveBrowserSource(params, { browserbase }),
  });
  return { stagehand, browserbaseResources: resources };
}

async function importV4SiblingModule(
  sdkPath: string,
  moduleName: string,
  importModule: V4SdkModuleImporter,
): Promise<Record<string, unknown>> {
  const extension = path.extname(sdkPath);
  if (extension !== ".ts" && extension !== ".js" && extension !== ".mjs") {
    throw new Error(
      `V4 Browserbase support requires a source or built SDK entry with a .ts, .js, or .mjs extension; received ${sdkPath}.`,
    );
  }
  const siblingPath = path.join(
    path.dirname(path.resolve(sdkPath)),
    `${moduleName}${extension}`,
  );
  return importModule(pathToFileURL(siblingPath).href);
}

function requireFunction(
  module: Record<string, unknown>,
  name: string,
): UnknownMethod {
  const value = module[name];
  if (typeof value !== "function") {
    throw new Error(
      `Pinned V4 Browserbase scaffolding requires internal export ${name}.`,
    );
  }
  return value as UnknownMethod;
}

export function createV4DeterministicFacades(rawContext: unknown): {
  context: V4DeterministicContextFacade;
  wrapPage: (rawPage: unknown) => V4DeterministicPageFacade;
} {
  return createV4CodeFacades(rawContext, "deterministic") as {
    context: V4DeterministicContextFacade;
    wrapPage: (rawPage: unknown) => V4DeterministicPageFacade;
  };
}

export function createV4CodeFacades(
  rawContext: unknown,
  mode: V4CodeMode,
  rawStagehand?: unknown,
): {
  context: V4CodeContextFacade;
  wrapPage: (rawPage: unknown) => V4CodePageFacade;
  stagehand?: V4AiStagehandFacade;
} {
  const contextTarget = requireObject(rawContext, "V4 browser context");
  const pagesByRaw = new WeakMap<object, V4CodePageFacade>();
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

  const wrapPage = (rawPage: unknown): V4CodePageFacade => {
    const pageTarget = requireObject(rawPage, "V4 page");
    const existing = pagesByRaw.get(pageTarget);
    if (existing) return existing;

    const facade: V4CodePageFacade = {
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

  const context: V4CodeContextFacade = {
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
          "context.setActivePage() requires a page returned by this V4 context.",
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
      throw new Error("clipboard page must come from this V4 context.");
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

  const stagehand =
    mode === "ai"
      ? createV4AiStagehandFacade(rawStagehand, unwrapStagehandOptions)
      : undefined;

  function unwrapStagehandOptions(options: unknown): unknown {
    if (!isRecord(options) || options.page === undefined) return options;
    if (!isObject(options.page)) {
      throw new Error("Stagehand page must be a V4 page facade.");
    }
    const rawPage = rawPagesByFacade.get(options.page);
    if (!rawPage) {
      throw new Error("Stagehand page must come from this V4 context.");
    }
    return { ...options, page: rawPage };
  }

  return {
    context,
    wrapPage,
    ...(stagehand && { stagehand }),
  };
}

export async function executeV4DeterministicSnippet(input: {
  code: string;
  runtime: Pick<V4DeterministicRuntime, "page" | "context">;
  startUrl: string;
  task: Record<string, unknown>;
  console: Pick<Console, "log" | "warn" | "error">;
}): Promise<unknown> {
  return executeV4CodeSnippet({ ...input, mode: "deterministic" });
}

export async function executeV4CodeSnippet(input: {
  code: string;
  runtime: Pick<V4CodeRuntime, "page" | "context" | "stagehand">;
  mode: V4CodeMode;
  startUrl: string;
  task: Record<string, unknown>;
  console: Pick<Console, "log" | "warn" | "error">;
}): Promise<unknown> {
  const AsyncFunction = Object.getPrototypeOf(async function () {})
    .constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<unknown>;
  const names = ["page", "context", "startUrl", "task", "console"];
  const values: unknown[] = [
    input.runtime.page,
    input.runtime.context,
    input.startUrl,
    input.task,
    input.console,
  ];
  if (input.mode === "ai") {
    if (!input.runtime.stagehand) {
      throw new Error("AI-enabled V4 snippets require a Stagehand facade.");
    }
    names.push("stagehand", "z");
    values.push(input.runtime.stagehand, z);
  }
  const fn = new AsyncFunction(...names, input.code);
  return fn(...values);
}

function createV4AiStagehandFacade(
  rawStagehand: unknown,
  unwrapOptions: (options: unknown) => unknown,
): V4AiStagehandFacade {
  const stagehandTarget = requireObject(rawStagehand, "V4 Stagehand instance");
  const facade: V4AiStagehandFacade = {
    act: (instruction, options) =>
      invoke(
        stagehandTarget,
        "act",
        options === undefined
          ? [instruction]
          : [instruction, unwrapOptions(options)],
      ),
    observe: (instruction, options) =>
      invoke(
        stagehandTarget,
        "observe",
        options === undefined
          ? instruction === undefined
            ? []
            : [instruction]
          : [instruction, unwrapOptions(options)],
      ),
    extract: (instruction, schema, options) =>
      invoke(
        stagehandTarget,
        "extract",
        options === undefined
          ? [instruction, schema]
          : [instruction, schema, unwrapOptions(options)],
      ),
  };
  return Object.freeze(facade);
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

function normalizeV4StagehandMetrics(value: unknown): Record<string, number> {
  const metrics = requireObject(value, "V4 Stagehand metrics");
  const normalized: Record<string, number> = {};
  for (const [key, entry] of Object.entries(metrics)) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      throw new Error(`V4 Stagehand metric ${key} is not a finite number.`);
    }
    normalized[key] = entry;
  }
  return normalized;
}

function isV4MetricsNotImplementedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /method not implemented by the smoke runtime/i.test(error.message)
  );
}

function resolveRuntimeModel(
  mode: V4CodeMode,
  model: V4CodeModelConfig | undefined,
): V4CodeModelConfig | undefined {
  if (mode === "deterministic") {
    if (model) {
      throw new Error(
        "Deterministic V4 runtime must not receive model configuration.",
      );
    }
    return undefined;
  }
  if (!model?.modelName.trim() || !model.apiKey.trim()) {
    throw new Error(
      "AI-enabled V4 runtime requires a model name and provider API key.",
    );
  }
  return model;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return isObject(value);
}
