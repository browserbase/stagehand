import { randomUUID } from "crypto";

import { StatusCodes } from "http-status-codes";

import { retry } from "../../../lib/bubus.js";
import { AppError } from "../../../lib/errorHandler.js";
import {
  BrowserGetEvent,
  BrowserKillEvent,
  BrowserLaunchOrConnectEvent,
  BrowserListEvent,
  BrowserSetViewportEvent,
  BrowserSetWindowSizeEvent,
  BrowserTriggerExtensionActionEvent,
} from "../../events.js";
import type { V4BrowserRecord } from "../../types.js";
import {
  canInitializeWithoutRequestApiKey,
  getStagehandForBrowser,
  nowIso,
  resolveBrowserOrThrow,
  type ServiceDeps,
} from "../base.js";

const LOCAL_BROWSER_LAUNCH_TIMEOUT = 90;
const LOCAL_BROWSER_LAUNCH_MAX_ATTEMPTS = 3;

export type BrowserLaunchPayload = {
  browserType?: "local" | "remote" | "browserbase";
  browserId?: string;
  apiSessionId?: string;
  modelName: string;
  llmId?: string;
  modelApiKey?: string;
  cdpUrl?: string;
  region: string;
  browserLaunchOptions?: Record<string, unknown>;
  browserbaseSessionId?: string;
  browserbaseSessionCreateParams?: Record<string, unknown>;
  browserbaseApiKey?: string;
  browserbaseProjectId?: string;
};

export abstract class BaseBrowserService {
  protected abstract readonly browserMode: V4BrowserRecord["browserMode"];

  constructor(protected readonly deps: ServiceDeps) {
    this.deps.bus.on(BrowserListEvent, this.onBrowserListEvent.bind(this));
    this.deps.bus.on(
      BrowserLaunchOrConnectEvent,
      retry({
        timeout: LOCAL_BROWSER_LAUNCH_TIMEOUT,
        max_attempts: LOCAL_BROWSER_LAUNCH_MAX_ATTEMPTS,
        semaphore_limit: 5,
        semaphore_scope: "global",
        semaphore_name: "local-browser-launching",
        semaphore_timeout: 30,
      })(this.onBrowserLaunchOrConnectEvent.bind(this)),
    );
    this.deps.bus.on(BrowserGetEvent, this.onBrowserGetEvent.bind(this));
    this.deps.bus.on(
      BrowserKillEvent,
      retry({ timeout: 10, max_attempts: 2 })(
        this.onBrowserKillEvent.bind(this),
      ),
    );
    this.deps.bus.on(
      BrowserSetViewportEvent,
      this.onBrowserSetViewportEvent.bind(this),
    );
    this.deps.bus.on(
      BrowserSetWindowSizeEvent,
      this.onBrowserSetWindowSizeEvent.bind(this),
    );
    this.deps.bus.on(
      BrowserTriggerExtensionActionEvent,
      this.onBrowserTriggerExtensionActionEvent.bind(this),
    );
  }

  protected abstract launchOrConnect(
    payload: BrowserLaunchPayload,
  ): Promise<{ browser: V4BrowserRecord }>;

  protected async finalizeLaunch(
    payload: BrowserLaunchPayload,
    startResult: { sessionId: string; cdpUrl?: string; available: boolean },
  ): Promise<{ browser: V4BrowserRecord }> {
    const now = nowIso();
    const browserId = payload.browserId ?? startResult.sessionId ?? randomUUID();

    let cdpUrl = startResult.cdpUrl ?? payload.cdpUrl ?? "";
    const canInitNow =
      Boolean(payload.modelApiKey) ||
      canInitializeWithoutRequestApiKey(payload.modelName);

    if (canInitNow) {
      const stagehand = await this.deps.sessionStore.getOrCreateStagehand(
        startResult.sessionId,
        {
          modelApiKey: payload.modelApiKey,
        },
      );
      cdpUrl = stagehand.connectURL();
    }

    const browser: V4BrowserRecord = {
      id: browserId,
      apiSessionId: payload.apiSessionId ?? browserId,
      sessionId: startResult.sessionId,
      browserMode: this.browserMode,
      modelName: payload.modelName,
      llmId: payload.llmId,
      region: payload.region,
      status: "running",
      launchedAt: now,
      exitedAt: null,
      cdpUrl,
      browserVersion: null,
      browserName: null,
      publicIpAddress: null,
      memoryUsage: null,
      cpuUsage: null,
      createdAt: now,
      updatedAt: now,
    };

    this.deps.state.putBrowser(browser);
    return { browser };
  }

  private ensureRunning(browser: V4BrowserRecord): void {
    if (browser.status !== "running") {
      throw new AppError(
        `Browser is not running: ${browser.id}`,
        StatusCodes.BAD_REQUEST,
      );
    }
  }

  private touchBrowser(
    browser: V4BrowserRecord,
    overrides?: Partial<V4BrowserRecord>,
  ): V4BrowserRecord {
    const updated: V4BrowserRecord = {
      ...browser,
      updatedAt: nowIso(),
      ...overrides,
    };
    this.deps.state.putBrowser(updated);
    return updated;
  }

  private async onBrowserListEvent(): Promise<{ browsers: V4BrowserRecord[] }> {
    return { browsers: this.deps.state.listBrowsers() };
  }

  private async onBrowserLaunchOrConnectEvent(
    event: ReturnType<typeof BrowserLaunchOrConnectEvent>,
  ): Promise<{ browser: V4BrowserRecord }> {
    const payload = event as unknown as BrowserLaunchPayload;

    if (
      payload.apiSessionId &&
      this.deps.state.getBrowserByApiSessionId(payload.apiSessionId)?.status ===
        "running"
    ) {
      throw new AppError(
        `A browser is already running for session ${payload.apiSessionId}`,
        StatusCodes.CONFLICT,
      );
    }

    return this.launchOrConnect(payload);
  }

  private async onBrowserGetEvent(
    event: ReturnType<typeof BrowserGetEvent>,
  ): Promise<{ browser: V4BrowserRecord }> {
    const payload = event as unknown as { browserId: string };
    const browser = this.deps.state.getBrowser(payload.browserId);

    if (!browser) {
      throw new AppError(
        `Browser not found: ${payload.browserId}`,
        StatusCodes.NOT_FOUND,
      );
    }

    return { browser };
  }

  private async onBrowserKillEvent(
    event: ReturnType<typeof BrowserKillEvent>,
  ): Promise<{ browser: V4BrowserRecord }> {
    const payload = event as unknown as { browserId: string };
    const browser = this.deps.state.getBrowser(payload.browserId);

    if (!browser) {
      throw new AppError(
        `Browser not found: ${payload.browserId}`,
        StatusCodes.NOT_FOUND,
      );
    }

    await this.deps.sessionStore.endSession(browser.sessionId);
    const updated = this.deps.state.stopBrowser(browser.id);

    return { browser: updated };
  }

  private async onBrowserSetViewportEvent(
    event: ReturnType<typeof BrowserSetViewportEvent>,
  ): Promise<{ browser: V4BrowserRecord; applied: boolean }> {
    const payload = event as unknown as {
      browserId?: string;
      sessionId?: string;
      modelApiKey?: string;
      width: number;
      height: number;
      deviceScaleFactor?: number;
    };

    const browser = resolveBrowserOrThrow(
      this.deps.state,
      payload.browserId,
      payload.sessionId,
    );
    this.ensureRunning(browser);

    const stagehand = await getStagehandForBrowser(
      this.deps,
      browser,
      payload.modelApiKey,
    );
    const page = await stagehand.context.awaitActivePage();
    await page.setViewportSize(payload.width, payload.height, {
      deviceScaleFactor: payload.deviceScaleFactor,
    });

    const updated = this.touchBrowser(browser);
    return { browser: updated, applied: true };
  }

  private async onBrowserSetWindowSizeEvent(
    event: ReturnType<typeof BrowserSetWindowSizeEvent>,
  ): Promise<{ browser: V4BrowserRecord; applied: boolean }> {
    const payload = event as unknown as {
      browserId?: string;
      sessionId?: string;
      modelApiKey?: string;
      width: number;
      height: number;
    };

    const browser = resolveBrowserOrThrow(
      this.deps.state,
      payload.browserId,
      payload.sessionId,
    );
    this.ensureRunning(browser);

    const stagehand = await getStagehandForBrowser(
      this.deps,
      browser,
      payload.modelApiKey,
    );
    const page = await stagehand.context.awaitActivePage();
    await page.setViewportSize(payload.width, payload.height);

    const updated = this.touchBrowser(browser);
    return { browser: updated, applied: true };
  }

  private async onBrowserTriggerExtensionActionEvent(
    event: ReturnType<typeof BrowserTriggerExtensionActionEvent>,
  ): Promise<{ browser: V4BrowserRecord; applied: boolean; note: string }> {
    const payload = event as unknown as {
      browserId?: string;
      sessionId?: string;
    };

    const browser = resolveBrowserOrThrow(
      this.deps.state,
      payload.browserId,
      payload.sessionId,
    );
    this.ensureRunning(browser);

    const updated = this.touchBrowser(browser);

    return {
      browser: updated,
      applied: false,
      note: "triggerExtensionAction is registered but currently a no-op in server v4",
    };
  }
}
