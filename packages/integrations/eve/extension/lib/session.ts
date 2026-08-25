import {
  browserbase,
  Stagehand,
  StagehandCreateOptionsSchema,
  type BrowserbaseLaunchOptions,
  type StagehandBrowser,
} from "@browserbasehq/stagehand";

import extension from "../extension.js";
import { StagehandFacadeTools } from "./core-facade/tools.js";
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
export type StagehandResourceCleanup = (resources: StagehandResources) => Promise<void>;

export interface StagehandSessionOptions {
  operationTimeoutMs?: number;
  healthCheckTimeoutMs?: number;
  cleanupTimeoutMs?: number;
}

const DEFAULT_OPERATION_TIMEOUT_MS = 75_000;
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5_000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 10_000;

export class StagehandSessionCleanupError extends Error {
  override readonly name = "StagehandSessionCleanupError";

  constructor() {
    super("Failed to close the Stagehand browser session.");
  }
}

export class StagehandSessionInitializationError extends Error {
  override readonly name = "StagehandSessionInitializationError";

  constructor() {
    super("Stagehand initialization failed and the browser session could not be closed.");
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
    await withTimeout(
      this.cleanupResources(expected),
      this.options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS,
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
      throw error;
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
    if (!this.detach(expected)) return;
    await withTimeout(
      this.cleanupResources(expected),
      this.options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS,
      "Stagehand browser cleanup",
    ).catch(() => undefined);
  }

  private detach(expected: StagehandResources): boolean {
    if (this.resources !== expected) return false;
    this.resources = undefined;
    this.resourcesPromise = undefined;
    return true;
  }
}

export const stagehandSession = new StagehandSession();

export function createStagehandResourceFactory(
  launchBrowser: StagehandBrowserLauncher = createBrowser,
  createStagehand: StagehandCreator = createStagehandClient,
): StagehandResourceFactory {
  const pendingReleases = new Set<StagehandSessionRelease>();

  return async (onCloseRequested) => {
    await retryPendingReleases(pendingReleases);
    const launched = await launchBrowser();
    const releaseSession = launched.releaseSession
      ? trackRelease(launched.releaseSession, pendingReleases)
      : undefined;
    try {
      const stagehand = await createStagehand(launched.browser);
      let resources!: StagehandResources;
      const tools = new StagehandFacadeTools(stagehand, {
        onCloseRequested: () => onCloseRequested?.(resources) ?? Promise.resolve(),
      });
      resources = { browser: launched.browser, stagehand, tools };
      if (releaseSession) resources.releaseSession = releaseSession;
      return resources;
    } catch (error) {
      let browserCloseFailed = false;
      await launched.browser.close().catch(() => {
        browserCloseFailed = true;
      });
      if (browserCloseFailed && releaseSession) {
        try {
          await releaseSession();
          browserCloseFailed = false;
        } catch {
          throw new StagehandSessionInitializationError();
        }
      }
      if (browserCloseFailed) throw new StagehandSessionInitializationError();
      throw error;
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

export async function closeStagehandResources(resources: StagehandResources): Promise<void> {
  const [, browserClose] = await Promise.allSettled([
    resources.stagehand.close(),
    resources.browser.closed ? Promise.resolve() : resources.browser.close(),
  ]);

  // Stagehand.close() performs its local teardown in a finally block, but its closing RPC can lose
  // the CDP transport before the response arrives. Once browser.close() succeeds, the owned local
  // browser or Browserbase session is released, so that transport error is no longer actionable.
  if (browserClose.status !== "rejected") return;
  if (resources.releaseSession) {
    try {
      await resources.releaseSession();
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
  const trackedRelease = async () => {
    try {
      await releaseSession();
      pendingReleases.delete(trackedRelease);
    } catch {
      pendingReleases.add(trackedRelease);
      throw new BrowserbaseSessionReleaseError();
    }
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
