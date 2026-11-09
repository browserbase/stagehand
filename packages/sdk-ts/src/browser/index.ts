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
  /** CDP URL to reconnect with localBrowser.connect(); undefined for Browserbase browsers. */
  readonly cdpUrl?: string;
  readonly context: BrowserContext;
  /** True once close() or disconnect() was called. */
  readonly closed: boolean;
  /**
   * False once the handle is closed or disconnected, or its connection was lost. After a
   * lost connection close() can still have work to do, such as releasing a Browserbase session.
   */
  readonly connected: boolean;
  /**
   * Closes the browser: a local browser receives Browser.close (a launched one is also terminated if it keeps running, and its
   * temporary profile removed unless preserved), and a Browserbase session is released.
   *
   * After disconnect() it rejects: connect() again to close the browser. After an
   * unexpectedly lost connection it still releases a Browserbase session and does
   * nothing for a local browser. Repeated close() calls do nothing.
   */
  close(): Promise<void>;
  /**
   * Closes the attached Stagehand instance, including the extension's own connection
   * to the browser, then Stagehand's connection. The browser keeps running.
   *
   * Stagehand never closes the browser or releases its Browserbase session here.
   * Browserbase still ends a session without keepAlive when its CDP connection
   * closes, so only keepAlive sessions survive a disconnect. The handle is finished
   * afterwards: connect() again for a new one. Repeated disconnect() calls, or
   * disconnect() after close(), do nothing.
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
  connected: () => boolean;
  /** What close() does after an unexpectedly lost connection. */
  closeWithoutConnection: () => Promise<void> | void;
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
    readonly cdpUrl?: string,
  ) {
    browserHandleInternals.set(this, internals);
  }

  get closed(): boolean {
    const state = browserHandleInternals.get(this)?.state;
    return state !== undefined && state !== "open";
  }

  get connected(): boolean {
    const internals = browserHandleInternals.get(this);
    return internals !== undefined && internals.state === "open" && internals.connected();
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
    if (internals.closePromise) return internals.closePromise;
    if (internals.state === "disconnected") {
      return Promise.reject(new Error(BROWSER_DISCONNECTED_MESSAGE));
    }
    internals.state = "closed";
    if (internals.connected()) {
      internals.closePromise = Promise.resolve().then(internals.close);
    } else {
      const closePromise = Promise.resolve()
        .then(internals.closeWithoutConnection)
        .catch((error: unknown) => {
          // Releasing over the Browserbase API can fail transiently: allow a retry.
          if (internals.closePromise === closePromise) internals.closePromise = undefined;
          throw error;
        });
      internals.closePromise = closePromise;
    }
    return internals.closePromise;
  }

  disconnect(): Promise<void> {
    const internals = requireBrowserHandleInternals(this);
    if (internals.closePromise) return internals.closePromise;
    if (!internals.disconnectPromise) {
      internals.state = "disconnected";
      const closeStagehand = internals.closeStagehand;
      internals.disconnectPromise = Promise.resolve()
        .then(async () => {
          try {
            await closeStagehandWithin(closeStagehand, DISCONNECT_STAGEHAND_TIMEOUT_MS);
          } finally {
            await internals.disconnect();
          }
        })
        .catch((error: unknown) => {
          // Still connected means nothing was let go: keep the handle usable for a retry.
          if (internals.connected()) {
            internals.state = "open";
            internals.disconnectPromise = undefined;
          }
          throw error;
        });
    }
    return internals.disconnectPromise;
  }
}

const DISCONNECT_STAGEHAND_TIMEOUT_MS = 10_000;

/**
 * stagehand.close() waits for in-flight work without a deadline; disconnect() stops
 * waiting after timeoutMs and lets go anyway, which also ends that work.
 */
async function closeStagehandWithin(
  closeStagehand: (() => Promise<void>) | undefined,
  timeoutMs: number,
): Promise<void> {
  if (!closeStagehand) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closing = closeStagehand();
  try {
    await Promise.race([
      closing,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // Settles once the connection closes; never leave its rejection unhandled.
    closing.catch(() => undefined);
  }
}

const BROWSER_DISCONNECTED_MESSAGE = "The browser is disconnected; connect() again to close it";

/** @internal */
export function createStagehandBrowserHandle<Attachment>(options: {
  provider: StagehandBrowserProvider;
  origin: StagehandBrowserOrigin;
  attachment: Attachment;
  close: () => Promise<void> | void;
  invalidate?: () => Promise<void> | void;
  /** Closes only the connection; defaults to doing nothing. */
  disconnect?: () => Promise<void> | void;
  /** Whether the connection is still open; defaults to true. */
  connected?: () => boolean;
  /** What close() does after an unexpectedly lost connection; defaults to doing nothing. */
  closeWithoutConnection?: () => Promise<void> | void;
  sessionId?: string;
  cdpUrl?: string;
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
      connected: options.connected ?? (() => true),
      closeWithoutConnection: options.closeWithoutConnection ?? (() => undefined),
      state: "open",
    },
    options.sessionId,
    options.cdpUrl,
  );
}

/** @internal */
export function claimStagehandBrowserHandle<Attachment>(browser: StagehandBrowser): Attachment {
  const internals = requireBrowserHandleInternals(browser);
  if (internals.state !== "open" || !internals.connected()) {
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
