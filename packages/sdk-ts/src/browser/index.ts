import type {
  BrowserbaseConnectOptions,
  BrowserbaseLaunchOptions,
  LocalBrowserConnectOptions,
  LocalBrowserLaunchOptions,
} from "../clientSchemas.js";
import type { BrowserContext } from "../browserContext.js";

export type {
  BrowserbaseConnectOptions,
  BrowserbaseLaunchOptions,
  LocalBrowserConnectOptions,
  LocalBrowserLaunchOptions,
};

const stagehandBrowserBrand: unique symbol = Symbol("StagehandBrowser");

export type StagehandBrowserProvider = "local" | "browserbase";
export type StagehandBrowserOrigin = "launched" | "connected";

/**
 * A browser whose Stagehand extension is ready for its first RPC call.
 *
 * Browser handles are created by Stagehand's browser factories. The private
 * brand prevents arbitrary CDP connections from being passed to Stagehand.
 */
export interface StagehandBrowser {
  readonly [stagehandBrowserBrand]: true;
  readonly provider: StagehandBrowserProvider;
  readonly origin: StagehandBrowserOrigin;
  /** Browserbase session id backing this browser; undefined for local browsers. */
  readonly sessionId?: string;
  readonly context: BrowserContext;
  readonly closed: boolean;
  close(): Promise<void>;
}

export interface LocalBrowser {
  launch(options?: LocalBrowserLaunchOptions): Promise<StagehandBrowser>;
  connect(options: LocalBrowserConnectOptions): Promise<StagehandBrowser>;
}

export interface BrowserbaseBrowser {
  launch(options: BrowserbaseLaunchOptions): Promise<StagehandBrowser>;
  connect(options: BrowserbaseConnectOptions): Promise<StagehandBrowser>;
}

type BrowserHandleInternals = {
  claimed: boolean;
  attachment: unknown;
  context?: BrowserContext;
  close: () => Promise<void> | void;
  invalidate: () => Promise<void> | void;
  terminalPromise?: Promise<void>;
};

const browserHandleInternals = new WeakMap<StagehandBrowser, BrowserHandleInternals>();

class StagehandBrowserHandle implements StagehandBrowser {
  readonly [stagehandBrowserBrand] = true as const;

  constructor(
    readonly provider: StagehandBrowserProvider,
    readonly origin: StagehandBrowserOrigin,
    internals: BrowserHandleInternals,
    readonly sessionId?: string,
  ) {
    browserHandleInternals.set(this, internals);
  }

  get closed(): boolean {
    return browserHandleInternals.get(this)?.terminalPromise !== undefined;
  }

  get context(): BrowserContext {
    const context = requireBrowserHandleInternals(this).context;
    if (!context) {
      throw new Error(
        "Browser context is unavailable. Attach the browser with await Stagehand.create({ browser }).",
      );
    }
    return context;
  }

  close(): Promise<void> {
    const internals = requireBrowserHandleInternals(this);
    internals.terminalPromise ??= Promise.resolve().then(internals.close);
    return internals.terminalPromise;
  }
}

/** @internal */
export function createStagehandBrowserHandle<Attachment>(options: {
  provider: StagehandBrowserProvider;
  origin: StagehandBrowserOrigin;
  attachment: Attachment;
  close: () => Promise<void> | void;
  invalidate?: () => Promise<void> | void;
  sessionId?: string;
}): StagehandBrowser {
  return new StagehandBrowserHandle(
    options.provider,
    options.origin,
    {
      claimed: false,
      attachment: options.attachment,
      close: options.close,
      invalidate: options.invalidate ?? options.close,
    },
    options.sessionId,
  );
}

/** @internal */
export function claimStagehandBrowserHandle<Attachment>(browser: StagehandBrowser): Attachment {
  const internals = requireBrowserHandleInternals(browser);
  if (internals.terminalPromise) {
    throw new Error("Cannot attach Stagehand to a closed browser");
  }
  if (internals.claimed) {
    throw new Error("This browser is already attached to a Stagehand instance");
  }
  internals.claimed = true;
  return internals.attachment as Attachment;
}

/** @internal */
export function invalidateStagehandBrowserHandle(browser: StagehandBrowser): Promise<void> {
  const internals = requireBrowserHandleInternals(browser);
  internals.terminalPromise ??= Promise.resolve().then(internals.invalidate);
  return internals.terminalPromise;
}

/** @internal */
export function releaseStagehandBrowserHandle(browser: StagehandBrowser): void {
  const internals = requireBrowserHandleInternals(browser);
  internals.claimed = false;
}

/** @internal */
export function attachStagehandBrowserContext(
  browser: StagehandBrowser,
  context: BrowserContext,
): void {
  const internals = requireBrowserHandleInternals(browser);
  if (!internals.claimed) {
    throw new Error("Cannot attach a browser context before Stagehand claims the browser");
  }
  if (internals.context) {
    throw new Error("This browser already has a Stagehand context");
  }
  internals.context = context;
}

/** @internal */
export function detachStagehandBrowserContext(browser: StagehandBrowser): void {
  const internals = requireBrowserHandleInternals(browser);
  internals.context = undefined;
}

export function isStagehandBrowser(value: unknown): value is StagehandBrowser {
  return (
    typeof value === "object" &&
    value !== null &&
    browserHandleInternals.has(value as StagehandBrowser)
  );
}

function requireBrowserHandleInternals(browser: StagehandBrowser): BrowserHandleInternals {
  const internals = browserHandleInternals.get(browser);
  if (!internals) {
    throw new TypeError("browser must be created by localBrowser or browserbase");
  }
  return internals;
}
