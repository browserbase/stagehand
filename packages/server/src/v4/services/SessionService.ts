import { randomUUID } from "crypto";

import { StatusCodes } from "http-status-codes";

import { AppError } from "../../lib/errorHandler.js";
import {
  BrowserLaunchOrConnectEvent,
  LLMConnectEvent,
  SessionCreateEvent,
  SessionGetEvent,
  SessionListEvent,
  SessionUpdateBrowserEvent,
  SessionUpdateLLMClientsEvent,
} from "../events.js";
import type { V4BrowserRecord, V4SessionRecord } from "../types.js";
import { nowIso, type ServiceDeps } from "./base.js";

export class SessionService {
  constructor(private readonly deps: ServiceDeps) {
    this.deps.bus.on(SessionCreateEvent, this.on_SessionCreateEvent.bind(this));
    this.deps.bus.on(SessionGetEvent, this.on_SessionGetEvent.bind(this));
    this.deps.bus.on(SessionListEvent, this.on_SessionListEvent.bind(this));
    this.deps.bus.on(
      SessionUpdateBrowserEvent,
      this.on_SessionUpdateBrowserEvent.bind(this),
    );
    this.deps.bus.on(
      SessionUpdateLLMClientsEvent,
      this.on_SessionUpdateLLMClientsEvent.bind(this),
    );
  }

  private async on_SessionCreateEvent(
    event: ReturnType<typeof SessionCreateEvent>,
  ): Promise<{ session: V4SessionRecord; browser: V4BrowserRecord }> {
    const payload = event as unknown as {
      sessionId?: string;
      llmId?: string;
      browserId?: string;
      modelName?: string;
      modelApiKey?: string;
      browserType: "local" | "remote" | "browserbase";
      cdpUrl?: string;
      region: string;
      browserLaunchOptions?: Record<string, unknown>;
      browserbaseSessionId?: string;
      browserbaseSessionCreateParams?: Record<string, unknown>;
      browserbaseApiKey?: string;
      browserbaseProjectId?: string;
    };

    const sessionId = payload.sessionId ?? randomUUID();

    if (this.deps.state.getSession(sessionId)) {
      throw new AppError(
        `Session already exists: ${sessionId}`,
        StatusCodes.CONFLICT,
      );
    }

    const timestamp = nowIso();
    const existingBrowser = payload.browserId
      ? this.deps.state.getBrowser(payload.browserId)
      : undefined;

    if (payload.browserId && !existingBrowser) {
      throw new AppError(
        `Browser not found: ${payload.browserId}`,
        StatusCodes.NOT_FOUND,
      );
    }

    if (existingBrowser && existingBrowser.status !== "running") {
      throw new AppError(
        `Browser is not running: ${existingBrowser.id}`,
        StatusCodes.BAD_REQUEST,
      );
    }

    const preconfiguredLLM = payload.llmId
      ? this.deps.state.getLLM(payload.llmId)
      : undefined;
    const effectiveModelName =
      payload.modelName ??
      preconfiguredLLM?.modelName ??
      existingBrowser?.modelName ??
      "openai/gpt-4o-mini";

    this.deps.state.putSession({
      id: sessionId,
      browserId: existingBrowser?.id ?? sessionId,
      modelName: effectiveModelName,
      llmId: payload.llmId ?? existingBrowser?.llmId,
      status: "initializing",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    try {
      let browser: V4BrowserRecord;
      if (existingBrowser) {
        browser = existingBrowser;
      } else {
        const launch = this.deps.bus.emit(
          BrowserLaunchOrConnectEvent({
            browserType: payload.browserType,
            browserId: sessionId,
            apiSessionId: sessionId,
            modelName: effectiveModelName,
            llmId: payload.llmId,
            modelApiKey: payload.modelApiKey,
            cdpUrl: payload.cdpUrl,
            region: payload.region,
            browserLaunchOptions: payload.browserLaunchOptions,
            browserbaseSessionId: payload.browserbaseSessionId,
            browserbaseSessionCreateParams:
              payload.browserbaseSessionCreateParams,
            browserbaseApiKey: payload.browserbaseApiKey,
            browserbaseProjectId: payload.browserbaseProjectId,
          }),
        );

        await launch.done();
        browser = (launch.event_result as { browser: V4BrowserRecord }).browser;
      }

      if (existingBrowser) {
        const browserLink = this.deps.bus.emit(
          SessionUpdateBrowserEvent({
            sessionId,
            browserId: browser.id,
            modelName: browser.modelName,
            llmId: browser.llmId,
            status: "initializing",
          }),
        );
        await browserLink.done();
      }

      const llmConnect = this.deps.bus.emit(
        LLMConnectEvent({
          llmId: payload.llmId ?? browser.llmId,
          sessionId,
          browserId: browser.id,
          modelName: effectiveModelName,
          modelApiKey: payload.modelApiKey,
        }),
      );
      await llmConnect.done();

      const session = this.deps.state.getSession(sessionId);
      if (!session) {
        throw new AppError(`Session not found: ${sessionId}`, StatusCodes.NOT_FOUND);
      }

      return {
        session,
        browser,
      };
    } catch (error) {
      const failed: V4SessionRecord = {
        id: sessionId,
        browserId: existingBrowser?.id ?? sessionId,
        modelName: effectiveModelName,
        llmId: payload.llmId ?? existingBrowser?.llmId,
        status: "failed",
        createdAt: timestamp,
        updatedAt: nowIso(),
      };
      this.deps.state.putSession(failed);
      throw error;
    }
  }

  private async on_SessionGetEvent(
    event: ReturnType<typeof SessionGetEvent>,
  ): Promise<{ session: V4SessionRecord }> {
    const payload = event as unknown as { sessionId: string };
    const session = this.deps.state.getSession(payload.sessionId);

    if (!session) {
      throw new AppError(
        `Session not found: ${payload.sessionId}`,
        StatusCodes.NOT_FOUND,
      );
    }

    return { session };
  }

  private async on_SessionListEvent(): Promise<{ sessions: V4SessionRecord[] }> {
    return {
      sessions: this.deps.state.listSessions(),
    };
  }

  private async on_SessionUpdateBrowserEvent(
    event: ReturnType<typeof SessionUpdateBrowserEvent>,
  ): Promise<{ session: V4SessionRecord }> {
    const payload = event as unknown as {
      sessionId: string;
      browserId: string;
      modelName?: string;
      llmId?: string;
      status?: V4SessionRecord["status"];
    };

    const session = this.deps.state.getSession(payload.sessionId);
    if (!session) {
      throw new AppError(
        `Session not found: ${payload.sessionId}`,
        StatusCodes.NOT_FOUND,
      );
    }

    const browser = this.deps.state.getBrowser(payload.browserId);
    if (!browser) {
      throw new AppError(
        `Browser not found: ${payload.browserId}`,
        StatusCodes.NOT_FOUND,
      );
    }

    const updated: V4SessionRecord = {
      ...session,
      browserId: payload.browserId,
      modelName: payload.modelName ?? browser.modelName ?? session.modelName,
      llmId: payload.llmId ?? session.llmId,
      status: payload.status ?? session.status,
      updatedAt: nowIso(),
    };
    this.deps.state.putSession(updated);

    return { session: updated };
  }

  private async on_SessionUpdateLLMClientsEvent(
    event: ReturnType<typeof SessionUpdateLLMClientsEvent>,
  ): Promise<{ session: V4SessionRecord }> {
    const payload = event as unknown as {
      sessionId: string;
      llmId: string;
      modelName?: string;
      status?: V4SessionRecord["status"];
    };

    const session = this.deps.state.getSession(payload.sessionId);
    if (!session) {
      throw new AppError(
        `Session not found: ${payload.sessionId}`,
        StatusCodes.NOT_FOUND,
      );
    }

    const llm = this.deps.state.getLLM(payload.llmId);
    if (!llm) {
      throw new AppError(`LLM not found: ${payload.llmId}`, StatusCodes.NOT_FOUND);
    }

    const updated: V4SessionRecord = {
      ...session,
      llmId: payload.llmId,
      modelName: payload.modelName ?? llm.modelName ?? session.modelName,
      status:
        payload.status ??
        (session.status === "initializing" ? "running" : session.status),
      updatedAt: nowIso(),
    };
    this.deps.state.putSession(updated);

    return { session: updated };
  }
}
