import {
  browserbase,
  Stagehand,
  StagehandCreateOptionsSchema,
  type BrowserbaseLaunchOptions,
  type StagehandBrowser,
} from "@browserbasehq/stagehand";

import extension from "../extension.js";
import {
  StagehandFacadeCleanupError,
  StagehandFacadeExecutionError,
  StagehandFacadeInputError,
  StagehandFacadeTools,
} from "./core/facade/tools.js";
import { BrowserbaseSessionReleaseError, releaseBrowserbaseSession } from "./session-release.js";

type StagehandSessionRelease = () => Promise<void>;

export interface StagehandBrowserLaunch {
  browser: StagehandBrowser;
  releaseSession?: StagehandSessionRelease;
}

export type StagehandBrowserLauncher = () => Promise<StagehandBrowserLaunch>;
export type StagehandCreator = (browser: StagehandBrowser) => Promise<Stagehand>;

export interface StagehandResources {
  browser: StagehandBrowser;
  stagehand: Stagehand;
  tools: StagehandFacadeTools;
  releaseSession?: StagehandSessionRelease;
}

export type StagehandCloseRequest = (resources: StagehandResources) => Promise<void>;
export type StagehandResourceFactory = (
  onCloseRequested?: StagehandCloseRequest,
) => Promise<StagehandResources>;
export type StagehandResourceCleanup = (
  resources: StagehandResources,
  closeTimeoutMs?: number,
) => Promise<void>;

export interface StagehandSessionOptions {
  operationTimeoutMs?: number;
  healthCheckTimeoutMs?: number;
  cleanupTimeoutMs?: number;
}

const DEFAULT_OPERATION_TIMEOUT_MS = 75_000;
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5_000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 10_000;
const DEFAULT_BROWSER_CLOSE_TIMEOUT_MS = DEFAULT_CLEANUP_TIMEOUT_MS / 2;

export class StagehandSessionCleanupError extends Error {
  override readonly name = "StagehandSessionCleanupError";

  constructor() {
    super("Failed to close the Stagehand browser session.");
  }
}

export class StagehandSessionInitializationError extends Error {
  override readonly name = "StagehandSessionInitializationError";

  constructor() {
    super("Failed to initialize the Stagehand browser session.");
  }
}

export class StagehandSessionOperationError extends Error {
  override readonly name = "StagehandSessionOperationError";

  constructor() {
    super("The Stagehand browser operation failed. Retry the tool call.");
  }
}

const defaultResourceFactory = createStagehandResourceFactory();

export class StagehandSession {
  private resources: StagehandResources | undefined;
  private resourcesPromise: Promise<StagehandResources> | undefined;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly createResources: StagehandResourceFactory = defaultResourceFactory,
    private readonly cleanupResources: StagehandResourceCleanup = closeStagehandResources,
    private readonly options: StagehandSessionOptions = {},
  ) {}

  run<Result>(operation: (resources: StagehandResources) => Promise<Result>): Promise<Result> {
    const execute = () => this.execute(operation);
    const result = this.operationQueue.then(execute, execute);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async close(expected: StagehandResources): Promise<void> {
    if (!this.detach(expected)) return;
    const timeoutMs = this.options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
    await withTimeout(
      this.cleanupResources(expected, timeoutMs / 2),
      timeoutMs,
      "Stagehand browser cleanup",
    );
  }

  private async execute<Result>(
    operation: (resources: StagehandResources) => Promise<Result>,
  ): Promise<Result> {
    const current = await this.ensureResources();
    try {
      return await withTimeout(
        operation(current),
        this.options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS,
        "Stagehand operation",
      );
    } catch (error) {
      const operationTimedOut = error instanceof StagehandTimeoutError;
      const healthy =
        !operationTimedOut &&
        (await withTimeout(
          resourcesAreHealthy(current),
          this.options.healthCheckTimeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
          "Stagehand health check",
        ).catch(() => false));
      if (this.resources === current && !healthy) {
        await this.invalidate(current);
      }
      throw sanitizeOperationError(error);
    }
  }

  private async ensureResources(): Promise<StagehandResources> {
    if (this.resources && !this.resources.browser.closed) return this.resources;
    if (this.resources) await this.invalidate(this.resources);

    const pending = (this.resourcesPromise ??= this.createResources((resources) =>
      this.close(resources),
    ));
    try {
      const created = await pending;
      if (this.resourcesPromise === pending) this.resources = created;
      return created;
    } catch (error) {
      if (this.resourcesPromise === pending) this.resourcesPromise = undefined;
      throw error;
    }
  }

  private async invalidate(expected: StagehandResources): Promise<void> {
    await this.close(expected).catch(() => undefined);
  }

  private detach(expected: StagehandResources): boolean {
    if (this.resources !== expected) return false;
    this.resources = undefined;
    this.resourcesPromise = undefined;
    return true;
  }
}

export const stagehandSession = new StagehandSession();

function sanitizeOperationError(error: unknown): Error {
  if (
    error instanceof StagehandFacadeExecutionError ||
    error instanceof StagehandFacadeInputError ||
    error instanceof StagehandFacadeCleanupError ||
    error instanceof StagehandTimeoutError
  ) {
    return error;
  }
  if (error instanceof AggregateError) {
    return new AggregateError(
      error.errors.map(sanitizeOperationError),
      "Stagehand operation and cleanup failed.",
    );
  }
  return new StagehandSessionOperationError();
}

export function createStagehandResourceFactory(
  launchBrowser: StagehandBrowserLauncher = createBrowser,
  createStagehand: StagehandCreator = createStagehandClient,
): StagehandResourceFactory {
  const pendingReleases = new Set<StagehandSessionRelease>();

  return async (onCloseRequested) => {
    await retryPendingReleases(pendingReleases);
    let launched: StagehandBrowserLaunch;
    try {
      launched = await launchBrowser();
    } catch {
      throw new StagehandSessionInitializationError();
    }
    const releaseSession = launched.releaseSession
      ? trackRelease(launched.releaseSession, pendingReleases)
      : undefined;
    try {
      const stagehand = await createStagehand(launched.browser);
      let resources!: StagehandResources;
      const tools = new StagehandFacadeTools(stagehand, {
        onCloseRequested: () =>
          onCloseRequested ? onCloseRequested(resources) : closeStagehandResources(resources),
      });
      resources = { browser: launched.browser, stagehand, tools };
      if (releaseSession) resources.releaseSession = releaseSession;
      return resources;
    } catch {
      await closeOwnedBrowser(launched.browser, releaseSession).catch(() => undefined);
      throw new StagehandSessionInitializationError();
    }
  };
}

async function createBrowser(): Promise<StagehandBrowserLaunch> {
  const { apiKey, proxies, sessionTimeoutSeconds } = extension.config;
  const baseUrl = process.env.BROWSERBASE_API_URL;
  const launchOptions: BrowserbaseLaunchOptions = {
    apiKey,
    keepAlive: false,
    proxies,
    timeout: sessionTimeoutSeconds,
  };
  if (baseUrl) launchOptions.baseUrl = baseUrl;
  if (process.env.BROWSERBASE_PROJECT_ID) {
    launchOptions.projectId = process.env.BROWSERBASE_PROJECT_ID;
  }
  const browser = await browserbase.launch(launchOptions);
  const sessionId = browser.sessionId;
  const launched: StagehandBrowserLaunch = { browser };
  if (sessionId) {
    launched.releaseSession = () => releaseBrowserbaseSession({ apiKey, baseUrl, sessionId });
  }
  return launched;
}

function createStagehandClient(browser: StagehandBrowser): Promise<Stagehand> {
  const model = StagehandCreateOptionsSchema.shape.model.parse({
    modelName: extension.config.model,
  });
  return Stagehand.create({ browser, model, logging: { level: "off" } });
}

export async function closeStagehandResources(
  resources: StagehandResources,
  closeTimeoutMs = DEFAULT_BROWSER_CLOSE_TIMEOUT_MS,
): Promise<void> {
  // Stagehand 4.1 separates client disposal from owned-browser release. Start both;
  // a stalled client must not prevent browser cleanup or the REST fallback.
  const clientClose = withTimeout(
    Promise.resolve().then(() => resources.stagehand.close()),
    closeTimeoutMs,
    "Stagehand client cleanup",
  ).catch(() => undefined);
  try {
    await closeOwnedBrowser(resources.browser, resources.releaseSession, closeTimeoutMs);
  } finally {
    await clientClose;
  }
}

async function closeOwnedBrowser(
  browser: StagehandBrowser,
  releaseSession?: StagehandSessionRelease,
  timeoutMs = DEFAULT_BROWSER_CLOSE_TIMEOUT_MS,
): Promise<void> {
  try {
    await withTimeout(
      Promise.resolve().then(() => browser.close()),
      timeoutMs,
      "Stagehand browser close",
    );
    return;
  } catch {
    // A timeout or lost transport does not prove the owned session was released.
  }
  if (releaseSession) {
    try {
      await releaseSession();
      return;
    } catch {
      // The tracked release is retried before the next browser launch.
    }
  }
  throw new StagehandSessionCleanupError();
}

function trackRelease(
  releaseSession: StagehandSessionRelease,
  pendingReleases: Set<StagehandSessionRelease>,
): StagehandSessionRelease {
  let inFlight: Promise<void> | undefined;
  const trackedRelease = (): Promise<void> => {
    if (inFlight) return inFlight;
    // Register before awaiting: the outer cleanup deadline may expire while the
    // SDK is still releasing the session. A replacement must await that release.
    pendingReleases.add(trackedRelease);
    inFlight = Promise.resolve()
      .then(releaseSession)
      .then(
        () => {
          pendingReleases.delete(trackedRelease);
          inFlight = undefined;
        },
        () => {
          inFlight = undefined;
          throw new BrowserbaseSessionReleaseError();
        },
      );
    return inFlight;
  };
  return trackedRelease;
}

async function retryPendingReleases(pendingReleases: Set<StagehandSessionRelease>): Promise<void> {
  for (const releaseSession of pendingReleases) await releaseSession();
}

class StagehandTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms.`);
    this.name = "StagehandTimeoutError";
  }
}

async function withTimeout<Result>(
  operation: Promise<Result>,
  timeoutMs: number,
  label: string,
): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new StagehandTimeoutError(label, timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resourcesAreHealthy(resources: StagehandResources): Promise<boolean> {
  if (resources.browser.closed) return false;
  try {
    await resources.browser.context.pages();
    return true;
  } catch {
    return false;
  }
}
