import { randomUUID } from "crypto";

import { StatusCodes } from "http-status-codes";

import { AppError } from "../../../lib/errorHandler.js";
import {
  LLMConnectCheckEvent,
  LLMConnectEvent,
  LLMGetEvent,
  LLMListEvent,
  LLMRequestEvent,
  SessionUpdateLLMClientsEvent,
} from "../../events.js";
import type {
  V4LLMRecord,
  V4SessionRecord,
} from "../../types.js";
import {
  nowIso,
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

export type ResolvedLLMRequest = {
  payload: LLMRequestPayload & {
    messages: NonNullable<LLMRequestPayload["messages"]>;
  };
  llm: V4LLMRecord;
  mode: "dom" | "hybrid" | "cua";
};

export abstract class BaseLLMService {
  protected abstract readonly clientType: V4LLMRecord["clientType"];
  protected abstract on_LLMRequestEvent(
    event: ReturnType<typeof LLMRequestEvent>,
  ): Promise<{
    llmId: string;
    mode: "dom" | "hybrid" | "cua";
    modelName: string;
    result: unknown;
  }>;

  constructor(protected readonly deps: ServiceDeps) {
    this.deps.bus.on(LLMListEvent, this.on_LLMListEvent.bind(this));
    this.deps.bus.on(LLMGetEvent, this.on_LLMGetEvent.bind(this));
    this.deps.bus.on(LLMConnectEvent, this.on_LLMConnectEvent.bind(this));
    this.deps.bus.on(LLMRequestEvent, this.on_LLMRequestEvent.bind(this));
    this.deps.bus.on(
      LLMConnectCheckEvent,
      this.on_LLMConnectCheckEvent.bind(this),
    );
  }

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

  protected resolveLLMRequest(
    event: ReturnType<typeof LLMRequestEvent>,
  ): ResolvedLLMRequest {
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

    return {
      payload: {
        ...payload,
        messages,
      },
      llm,
      mode: payload.mode ?? llm.mode,
    };
  }

  private async on_LLMListEvent(): Promise<{ llms: V4LLMRecord[] }> {
    return { llms: this.deps.state.listLLMs() };
  }

  private async on_LLMGetEvent(
    event: ReturnType<typeof LLMGetEvent>,
  ): Promise<{ llm: V4LLMRecord }> {
    const payload = event as unknown as { llmId: string };
    return { llm: this.getLLMOrThrow(payload.llmId) };
  }

  protected async on_LLMConnectEvent(
    event: ReturnType<typeof LLMConnectEvent>,
  ): Promise<{ ok: boolean; llm: V4LLMRecord }> {
    const payload = event as unknown as LLMConnectPayload;

    const session = payload.sessionId
      ? this.getSessionOrThrow(payload.sessionId)
      : undefined;

    const llmId = payload.llmId ?? session?.llmId ?? randomUUID();
    const existing = this.deps.state.getLLM(llmId);
    const timestamp = nowIso();
    const modelName =
      payload.modelName ??
      existing?.modelName ??
      session?.modelName;

    if (!modelName) {
      throw new AppError(
        "LLM connect requires params.modelName (or a session with modelName)",
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
      const sessionUpdate = this.deps.bus.emit(
        SessionUpdateLLMClientsEvent({
          sessionId: session.id,
          llmId: llmRecord.id,
          modelName: llmRecord.modelName,
        }),
      );
      await sessionUpdate.done();
    }

    return {
      ok: true,
      llm: llmRecord,
    };
  }

  private async on_LLMConnectCheckEvent(
    event: ReturnType<typeof LLMConnectCheckEvent>,
  ): Promise<{ ok: boolean; modelName: string }> {
    const payload = event as unknown as {
      sessionId: string;
      modelApiKey?: string;
    };

    const connect = this.deps.bus.emit(
      LLMConnectEvent({
        sessionId: payload.sessionId,
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
