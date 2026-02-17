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
  SessionUpdateBrowserEvent,
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
    this.deps.bus.on(BrowserListEvent, this.on_BrowserListEvent.bind(this));
    this.deps.bus.on(
      BrowserLaunchOrConnectEvent,
      retry({
        timeout: LOCAL_BROWSER_LAUNCH_TIMEOUT,
        max_attempts: LOCAL_BROWSER_LAUNCH_MAX_ATTEMPTS,
        semaphore_limit: 5,
        semaphore_scope: "global",
        semaphore_name: "local-browser-launching",
        semaphore_timeout: 30,
      })(this.on_BrowserLaunchOrConnectEvent.bind(this)),
    );
    this.deps.bus.on(BrowserGetEvent, this.on_BrowserGetEvent.bind(this));
    this.deps.bus.on(
      BrowserKillEvent,
      retry({ timeout: 10, max_attempts: 2 })(
        this.on_BrowserKillEvent.bind(this),
      ),
    );
    this.deps.bus.on(
      BrowserSetViewportEvent,
      this.on_BrowserSetViewportEvent.bind(this),
    );
    this.deps.bus.on(
      BrowserSetWindowSizeEvent,
      this.on_BrowserSetWindowSizeEvent.bind(this),
    );
    this.deps.bus.on(
      BrowserTriggerExtensionActionEvent,
      this.on_BrowserTriggerExtensionActionEvent.bind(this),
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

  private async on_BrowserListEvent(): Promise<{ browsers: V4BrowserRecord[] }> {
    return { browsers: this.deps.state.listBrowsers() };
  }

  private async on_BrowserLaunchOrConnectEvent(
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

    const launched = await this.launchOrConnect(payload);

    if (payload.apiSessionId) {
      const sessionUpdate = this.deps.bus.emit(
        SessionUpdateBrowserEvent({
          sessionId: payload.apiSessionId,
          browserId: launched.browser.id,
          modelName: launched.browser.modelName,
          llmId: launched.browser.llmId,
        }),
      );
      await sessionUpdate.done();
    }

    return launched;
  }

  private async on_BrowserGetEvent(
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

  private async on_BrowserKillEvent(
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

  private async on_BrowserSetViewportEvent(
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

  private async on_BrowserSetWindowSizeEvent(
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

  private async on_BrowserTriggerExtensionActionEvent(
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
