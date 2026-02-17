import { randomUUID } from "crypto";

import { StatusCodes } from "http-status-codes";

import { AppError } from "../../../lib/errorHandler.js";
import {
  LLMConnectCheckEvent,
  LLMConnectEvent,
  LLMGetEvent,
  LLMListEvent,
  LLMRequestEvent,
} from "../../events.js";
import type {
  V4BrowserRecord,
  V4LLMRecord,
  V4SessionRecord,
} from "../../types.js";
import {
  getStagehandForBrowser,
  nowIso,
  resolveBrowserOrThrow,
  type ServiceDeps,
} from "../base.js";

export type LLMConnectPayload = {
  llmId?: string;
  sessionId?: string;
  browserId?: string;
  clientType?: "aisdk" | "custom";
  mode?: "dom" | "hybrid" | "cua";
  modelName?: string;
  modelApiKey?: string;
  provider?: string;
  baseURL?: string;
  clientOptions?: Record<string, unknown>;
};

export type LLMRequestPayload = {
  llmId?: string;
  sessionId?: string;
  browserId?: string;
  modelApiKey?: string;
  mode?: "dom" | "hybrid" | "cua";
  prompt?: string;
  messages?: Array<{
    role: "system" | "user" | "assistant";
    content: unknown;
  }>;
  options?: Record<string, unknown>;
};

export abstract class BaseLLMService {
  protected abstract readonly clientType: V4LLMRecord["clientType"];

  constructor(protected readonly deps: ServiceDeps) {
    this.deps.bus.on(LLMListEvent, this.onLLMListEvent.bind(this));
    this.deps.bus.on(LLMGetEvent, this.onLLMGetEvent.bind(this));
    this.deps.bus.on(LLMConnectEvent, this.onLLMConnectEvent.bind(this));
    this.deps.bus.on(LLMRequestEvent, this.onLLMRequestEvent.bind(this));
    this.deps.bus.on(
      LLMConnectCheckEvent,
      this.onLLMConnectCheckEvent.bind(this),
    );
  }

  protected abstract requestModel(
    payload: LLMRequestPayload,
    llm: V4LLMRecord,
    browser: V4BrowserRecord,
  ): Promise<unknown>;

  private getSessionOrThrow(sessionId: string): V4SessionRecord {
    const session = this.deps.state.getSession(sessionId);
    if (!session) {
      throw new AppError(`Session not found: ${sessionId}`, StatusCodes.NOT_FOUND);
    }
    return session;
  }

  private getLLMOrThrow(llmId: string): V4LLMRecord {
    const llm = this.deps.state.getLLM(llmId);
    if (!llm) {
      throw new AppError(`LLM not found: ${llmId}`, StatusCodes.NOT_FOUND);
    }
    return llm;
  }

  private getBrowserForConnect(
    payload: LLMConnectPayload,
  ): V4BrowserRecord | undefined {
    if (payload.browserId) {
      return resolveBrowserOrThrow(this.deps.state, payload.browserId);
    }

    if (!payload.sessionId) {
      return undefined;
    }

    const session = this.getSessionOrThrow(payload.sessionId);
    return this.deps.state.getBrowser(session.browserId);
  }

  private resolveLLMForRequest(payload: LLMRequestPayload): V4LLMRecord {
    if (payload.llmId) {
      return this.getLLMOrThrow(payload.llmId);
    }

    if (payload.sessionId) {
      const session = this.getSessionOrThrow(payload.sessionId);
      if (session.llmId) {
        return this.getLLMOrThrow(session.llmId);
      }
    }

    throw new AppError(
      "LLM request requires params.llmId or params.sessionId with an attached llmId",
      StatusCodes.BAD_REQUEST,
    );
  }

  private async onLLMListEvent(): Promise<{ llms: V4LLMRecord[] }> {
    return { llms: this.deps.state.listLLMs() };
  }

  private async onLLMGetEvent(
    event: ReturnType<typeof LLMGetEvent>,
  ): Promise<{ llm: V4LLMRecord }> {
    const payload = event as unknown as { llmId: string };
    return { llm: this.getLLMOrThrow(payload.llmId) };
  }

  private async onLLMConnectEvent(
    event: ReturnType<typeof LLMConnectEvent>,
  ): Promise<{ ok: boolean; llm: V4LLMRecord }> {
    const payload = event as unknown as LLMConnectPayload;

    const session = payload.sessionId
      ? this.getSessionOrThrow(payload.sessionId)
      : undefined;
    const browser = this.getBrowserForConnect(payload);

    const llmId = payload.llmId ?? session?.llmId ?? randomUUID();
    const existing = this.deps.state.getLLM(llmId);
    const timestamp = nowIso();
    const modelName =
      payload.modelName ??
      existing?.modelName ??
      session?.modelName ??
      browser?.modelName;

    if (!modelName) {
      throw new AppError(
        "LLM connect requires params.modelName (or a session/browser with modelName)",
        StatusCodes.BAD_REQUEST,
      );
    }

    const llmRecord: V4LLMRecord = {
      id: llmId,
      clientType: this.clientType,
      mode: payload.mode ?? existing?.mode ?? "dom",
      modelName,
      modelApiKey: payload.modelApiKey ?? existing?.modelApiKey,
      provider: payload.provider ?? existing?.provider,
      baseURL: payload.baseURL ?? existing?.baseURL,
      clientOptions: {
        ...(existing?.clientOptions ?? {}),
        ...(payload.clientOptions ?? {}),
      },
      status: "ready",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    this.deps.state.putLLM(llmRecord);

    if (session) {
      this.deps.state.putSession({
        ...session,
        llmId: llmRecord.id,
        modelName: llmRecord.modelName,
        updatedAt: nowIso(),
      });
    }

    if (browser) {
      this.deps.state.putBrowser({
        ...browser,
        llmId: llmRecord.id,
        modelName: llmRecord.modelName,
        updatedAt: nowIso(),
      });
    }

    try {
      if (browser) {
        const stagehand = await getStagehandForBrowser(
          this.deps,
          browser,
          payload.modelApiKey ?? llmRecord.modelApiKey,
        );
        await stagehand.context.awaitActivePage();
      }
    } catch (error) {
      this.deps.state.putLLM({
        ...llmRecord,
        status: "failed",
        updatedAt: nowIso(),
      });
      throw error;
    }

    return {
      ok: true,
      llm: llmRecord,
    };
  }

  private async onLLMRequestEvent(
    event: ReturnType<typeof LLMRequestEvent>,
  ): Promise<{ llmId: string; mode: "dom" | "hybrid" | "cua"; modelName: string; result: unknown }> {
    const payload = event as unknown as LLMRequestPayload;
    const llm = this.resolveLLMForRequest(payload);

    const messages =
      payload.messages ??
      (payload.prompt
        ? [
            {
              role: "user" as const,
              content: payload.prompt,
            },
          ]
        : undefined);

    if (!messages || messages.length === 0) {
      throw new AppError(
        "LLM request requires params.prompt or params.messages",
        StatusCodes.BAD_REQUEST,
      );
    }

    const browser = resolveBrowserOrThrow(
      this.deps.state,
      payload.browserId,
      payload.sessionId,
    );

    const result = await this.requestModel(
      {
        ...payload,
        messages,
      },
      llm,
      browser,
    );

    return {
      llmId: llm.id,
      mode: payload.mode ?? llm.mode,
      modelName: llm.modelName,
      result,
    };
  }

  private async onLLMConnectCheckEvent(
    event: ReturnType<typeof LLMConnectCheckEvent>,
  ): Promise<{ ok: boolean; modelName: string }> {
    const payload = event as unknown as {
      sessionId: string;
      browserId?: string;
      modelApiKey?: string;
    };

    const connect = this.deps.bus.emit(
      LLMConnectEvent({
        sessionId: payload.sessionId,
        browserId: payload.browserId,
        modelApiKey: payload.modelApiKey,
      }),
    );
    await connect.done();

    const result = connect.event_result as { ok: boolean; llm: V4LLMRecord };
    return {
      ok: result.ok,
      modelName: result.llm.modelName,
    };
  }
}
