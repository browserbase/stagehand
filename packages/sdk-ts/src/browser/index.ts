import type {
  BrowserbaseConnectOptions,
  BrowserbaseLaunchOptions,
  LocalBrowserConnectOptions,
  LocalBrowserLaunchOptions,
} from "../clientSchemas.js";

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
  close: () => Promise<void> | void;
  closePromise?: Promise<void>;
};

const browserHandleInternals = new WeakMap<StagehandBrowser, BrowserHandleInternals>();

class StagehandBrowserHandle implements StagehandBrowser {
  readonly [stagehandBrowserBrand] = true as const;

  constructor(
    readonly provider: StagehandBrowserProvider,
    readonly origin: StagehandBrowserOrigin,
    internals: BrowserHandleInternals,
  ) {
    browserHandleInternals.set(this, internals);
  }

  get closed(): boolean {
    return browserHandleInternals.get(this)?.closePromise !== undefined;
  }

  close(): Promise<void> {
    const internals = requireBrowserHandleInternals(this);
    internals.closePromise ??= Promise.resolve().then(internals.close);
    return internals.closePromise;
  }
}

/** @internal */
export function createStagehandBrowserHandle<Attachment>(options: {
  provider: StagehandBrowserProvider;
  origin: StagehandBrowserOrigin;
  attachment: Attachment;
  close: () => Promise<void> | void;
}): StagehandBrowser {
  return new StagehandBrowserHandle(options.provider, options.origin, {
    claimed: false,
    attachment: options.attachment,
    close: options.close,
  });
}

/** @internal */
export function claimStagehandBrowserHandle<Attachment>(browser: StagehandBrowser): Attachment {
  const internals = requireBrowserHandleInternals(browser);
  if (internals.closePromise) {
    throw new Error("Cannot attach Stagehand to a closed browser");
  }
  if (internals.claimed) {
    throw new Error("This browser is already attached to a Stagehand instance");
  }
  internals.claimed = true;
  return internals.attachment as Attachment;
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
