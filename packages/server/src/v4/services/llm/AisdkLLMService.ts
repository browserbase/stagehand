import { V3, type LLMClient } from "@browserbasehq/stagehand";

import { LLMConnectEvent, LLMRequestEvent } from "../../events.js";
import type { V4LLMRecord } from "../../types.js";
import { nowIso } from "../base.js";
import { BaseLLMService } from "./BaseLLMService.js";

export class AisdkLLMService extends BaseLLMService {
  protected readonly clientType: V4LLMRecord["clientType"] = "aisdk";
  private static readonly llmClients = new Map<string, LLMClient>();

  private createLLMClient(llm: V4LLMRecord, modelApiKey?: string): LLMClient {
    const modelConfiguration = {
      ...(llm.clientOptions ?? {}),
      ...(llm.baseURL ? { baseURL: llm.baseURL } : {}),
      ...(modelApiKey ?? llm.modelApiKey
        ? { apiKey: modelApiKey ?? llm.modelApiKey }
        : {}),
      modelName: llm.modelName,
    };

    const stagehand = new V3({
      env: "LOCAL",
      model: modelConfiguration as any,
      disableAPI: true,
      disablePino: true,
      verbose: 0,
    });

    return stagehand.llmClient;
  }

  protected async on_LLMConnectEvent(
    event: ReturnType<typeof LLMConnectEvent>,
  ): Promise<{ ok: boolean; llm: V4LLMRecord }> {
    const connected = await super.on_LLMConnectEvent(event);

    try {
      AisdkLLMService.llmClients.set(
        connected.llm.id,
        this.createLLMClient(connected.llm),
      );
    } catch (error) {
      this.deps.state.putLLM({
        ...connected.llm,
        status: "failed",
        updatedAt: nowIso(),
      });
      throw error;
    }

    return connected;
  }

  protected async on_LLMRequestEvent(
    event: ReturnType<typeof LLMRequestEvent>,
  ): Promise<{ llmId: string; mode: "dom" | "hybrid" | "cua"; modelName: string; result: unknown }> {
    const { payload, llm, mode } = this.resolveLLMRequest(event);
    let client: LLMClient;
    if (payload.modelApiKey && payload.modelApiKey !== llm.modelApiKey) {
      client = this.createLLMClient(llm, payload.modelApiKey);
    } else {
      const existing = AisdkLLMService.llmClients.get(llm.id);
      if (existing) {
        client = existing;
      } else {
        client = this.createLLMClient(
          llm,
          payload.modelApiKey ?? llm.modelApiKey,
        );
        AisdkLLMService.llmClients.set(llm.id, client);
      }
    }

    const completionOptions = {
      ...(payload.options ?? {}),
      messages: payload.messages as any,
    };

    const result = await client.createChatCompletion({
      options: completionOptions as any,
      logger: () => {},
    });

    return {
      llmId: llm.id,
      mode,
      modelName: llm.modelName,
      result,
    };
  }
}
