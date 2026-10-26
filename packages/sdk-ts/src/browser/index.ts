import type {
  BrowserbaseClientOptions,
  BrowserbaseConnectOptions,
  BrowserbaseFetchOptions,
  BrowserbaseFetchResult,
  BrowserbaseLaunchOptions,
  BrowserbaseSearchOptions,
  BrowserbaseSearchResult,
  LocalBrowserConnectOptions,
  LocalBrowserLaunchOptions,
} from "../clientSchemas.js";
import type { BrowserContext } from "../browserContext.js";

export type {
  BrowserbaseClientOptions,
  BrowserbaseConnectOptions,
  BrowserbaseFetchOptions,
  BrowserbaseFetchResult,
  BrowserbaseLaunchOptions,
  BrowserbaseSearchOptions,
  BrowserbaseSearchResult,
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
  /**
   * Closes Stagehand's connection to the browser without closing the browser.
   *
   * It first closes an attached Stagehand instance, including the extension's own
   * connection to the browser, so a later connect() can create a new instance.
   *
   * Unlike close(), Stagehand never closes the browser or releases its Browserbase
   * session. Browserbase still ends a session without keepAlive when its CDP
   * connection closes, so only keepAlive sessions survive a disconnect. The
   * handle cannot be attached again. A later close() still releases what
   * Stagehand launched (the local Chrome process and profile, or the Browserbase
   * session) and does nothing for a browser you connected to; repeated
   * disconnect() calls, or disconnect() after close(), do nothing.
   */
  disconnect(): Promise<void>;
}

export interface LocalBrowser {
  launch(options?: LocalBrowserLaunchOptions): Promise<StagehandBrowser>;
  connect(options: LocalBrowserConnectOptions): Promise<StagehandBrowser>;
}

export interface BrowserbaseBrowser {
  launch(options: BrowserbaseLaunchOptions): Promise<StagehandBrowser>;
  connect(options: BrowserbaseConnectOptions): Promise<StagehandBrowser>;
  search(options: BrowserbaseSearchOptions): Promise<BrowserbaseSearchResult>;
  fetch(options: BrowserbaseFetchOptions): Promise<BrowserbaseFetchResult>;
}

type BrowserHandleInternals = {
  claimed: boolean;
  attachment: unknown;
  context?: BrowserContext;
  /** Closes the attached Stagehand instance; disconnect() runs it before dropping the connection. */
  closeStagehand?: () => Promise<void>;
  close: () => Promise<void> | void;
  invalidate: () => Promise<void> | void;
  disconnect: () => Promise<void> | void;
  /** Releases what Stagehand owns without the connection: close() after disconnect(). */
  releaseOwned: () => Promise<void> | void;
  state: "open" | "disconnected" | "closed";
  disconnectPromise?: Promise<void>;
  closePromise?: Promise<void>;
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
    const state = browserHandleInternals.get(this)?.state;
    return state !== undefined && state !== "open";
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
    if (!internals.closePromise) {
      const after = internals.state === "disconnected" ? internals.disconnectPromise : undefined;
      internals.state = "closed";
      internals.closePromise = after
        ? after.catch(() => undefined).then(internals.releaseOwned)
        : Promise.resolve().then(internals.close);
    }
    return internals.closePromise;
  }

  disconnect(): Promise<void> {
    const internals = requireBrowserHandleInternals(this);
    if (internals.state === "closed" && internals.closePromise) return internals.closePromise;
    if (!internals.disconnectPromise) {
      internals.state = "disconnected";
      const closeStagehand = internals.closeStagehand;
      internals.disconnectPromise = Promise.resolve().then(async () => {
        try {
          await closeStagehand?.();
        } finally {
          await internals.disconnect();
        }
      });
    }
    return internals.disconnectPromise;
  }
}

/** @internal */
export function createStagehandBrowserHandle<Attachment>(options: {
  provider: StagehandBrowserProvider;
  origin: StagehandBrowserOrigin;
  attachment: Attachment;
  close: () => Promise<void> | void;
  invalidate?: () => Promise<void> | void;
  /** Closes only the connection; defaults to doing nothing. */
  disconnect?: () => Promise<void> | void;
  /** What close() after disconnect() releases; defaults to doing nothing. */
  releaseOwned?: () => Promise<void> | void;
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
      disconnect: options.disconnect ?? (() => undefined),
      releaseOwned: options.releaseOwned ?? (() => undefined),
      state: "open",
    },
    options.sessionId,
  );
}

/** @internal */
export function claimStagehandBrowserHandle<Attachment>(browser: StagehandBrowser): Attachment {
  const internals = requireBrowserHandleInternals(browser);
  if (internals.state !== "open") {
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
  if (internals.state !== "open") {
    return internals.closePromise ?? internals.disconnectPromise ?? Promise.resolve();
  }
  internals.state = "closed";
  internals.closePromise = Promise.resolve().then(internals.invalidate);
  return internals.closePromise;
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
  closeStagehand?: () => Promise<void>,
): void {
  const internals = requireBrowserHandleInternals(browser);
  if (!internals.claimed) {
    throw new Error("Cannot attach a browser context before Stagehand claims the browser");
  }
  if (internals.context) {
    throw new Error("This browser already has a Stagehand context");
  }
  internals.context = context;
  internals.closeStagehand = closeStagehand;
}

/** @internal */
export function detachStagehandBrowserContext(browser: StagehandBrowser): void {
  const internals = requireBrowserHandleInternals(browser);
  internals.context = undefined;
  internals.closeStagehand = undefined;
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
