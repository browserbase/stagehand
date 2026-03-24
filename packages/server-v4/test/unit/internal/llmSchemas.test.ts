import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildInternalLLMConfigSnapshot,
  InternalLLMCallSchema,
  InternalLLMChatSchema,
  InternalLLMConfigSchema,
  InternalLLMConfigSetSchema,
  InternalLLMMessageSchema,
  InternalStagehandBrowserSessionSchema,
  InternalStagehandStepSchema,
  resolveInternalLLMConfigId,
} from "../../../src/schemas/internal/index.js";

const projectId = "550e8400-e29b-41d4-a716-446655440000";
const configId = "0195c7c6-7b71-7ed1-8ac5-8f8f7f318cc7";
const actConfigId = "0195c7c6-7b72-7339-91d0-b42c0339f0af";
const configSetId = "0195c7c6-7b73-7002-b735-3471f4f0b8b0";
const browserSessionId = "0195c7c6-7b74-75df-b8b4-42e50979d001";
const chatId = "0195c7c6-7b75-7e9e-98a2-f3b999c4aa11";
const stepId = "0195c7c6-7b76-7db4-8128-445ea7c81122";
const secondStepId = "0195c7c6-7b77-763e-bf87-efcc5ccf2233";
const callId = "0195c7c6-7b78-76af-89aa-93602ab84444";
const timestamp = "2026-02-03T12:00:00.000Z";

describe("internal llm data model schemas", () => {
  it("supports config-set fallback with default plus per-operation overrides", () => {
    const configSet = InternalLLMConfigSetSchema.parse({
      id: configSetId,
      projectId,
      defaultConfigId: configId,
      actConfigId,
      observeConfigId: null,
      extractConfigId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    assert.equal(resolveInternalLLMConfigId(configSet, "act"), actConfigId);
    assert.equal(resolveInternalLLMConfigId(configSet, "observe"), configId);
    assert.equal(resolveInternalLLMConfigId(configSet, "extract"), configId);

    const browserSession = InternalStagehandBrowserSessionSchema.parse({
      id: browserSessionId,
      projectId,
      env: "LOCAL",
      status: "running",
      browserbaseSessionId: null,
      cdpUrl: "ws://localhost:9222/devtools/browser/example",
      defaultConfigSetId: configSet.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      endedAt: null,
    });

    assert.equal(browserSession.defaultConfigSetId, configSet.id);
  });

  it("copies an immutable chat snapshot from the source config", () => {
    const config = InternalLLMConfigSchema.parse({
      id: configId,
      projectId,
      displayName: "Primary config",
      modelName: "openai/gpt-5-nano",
      baseUrl: "https://api.openai.com/v1",
      systemPrompt: "Be precise.",
      providerOptions: {
        temperature: 0.2,
        nested: {
          mode: "strict",
        },
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const snapshot = buildInternalLLMConfigSnapshot(config);
    (config.providerOptions as Record<string, unknown>).temperature = 0.9;
    (
      (config.providerOptions as Record<string, unknown>).nested as Record<
        string,
        unknown
      >
    ).mode = "mutated";

    const chat = InternalLLMChatSchema.parse({
      id: chatId,
      projectId,
      browserSessionId,
      sourceConfigId: config.id,
      forkedFromChatId: null,
      status: "idle",
      createdAt: timestamp,
      updatedAt: timestamp,
      lastMessageAt: null,
      lastErrorAt: null,
      ...snapshot,
    });

    assert.equal(chat.sourceConfigId, config.id);
    assert.equal(chat.modelName, "openai/gpt-5-nano");
    assert.equal(
      (chat.providerOptions as Record<string, unknown>).temperature,
      0.2,
    );
    assert.equal(
      (
        ((chat.providerOptions as Record<string, unknown>).nested ??
          {}) as Record<string, unknown>
      ).mode,
      "strict",
    );
  });

  it("tracks requested and resolved configs on a step and supports chat messages across steps", () => {
    const step = InternalStagehandStepSchema.parse({
      id: stepId,
      projectId,
      browserSessionId,
      chatId,
      operation: "act",
      configSetId,
      requestedConfigId: actConfigId,
      resolvedConfigId: actConfigId,
      params: {
        instruction: "click the primary button",
      },
      result: {
        success: true,
      },
      status: "completed",
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: timestamp,
    });

    const firstMessage = InternalLLMMessageSchema.parse({
      id: "0195c7c6-7b79-7fbb-a49f-4b994a1c5555",
      projectId,
      chatId,
      stepId: step.id,
      role: "user",
      content: {
        text: "click the primary button",
      },
      sequence: 0,
      createdAt: timestamp,
    });

    const secondMessage = InternalLLMMessageSchema.parse({
      id: "0195c7c6-7b80-702b-a15f-8cddf2d36666",
      projectId,
      chatId,
      stepId: secondStepId,
      role: "assistant",
      content: {
        text: "I clicked the button.",
      },
      sequence: 1,
      createdAt: timestamp,
    });

    assert.equal(step.requestedConfigId, actConfigId);
    assert.equal(step.resolvedConfigId, actConfigId);
    assert.equal(firstMessage.chatId, secondMessage.chatId);
    assert.notEqual(firstMessage.stepId, secondMessage.stepId);
  });

  it("allows raw provider-call rows to attach to a step and optionally a chat", () => {
    const call = InternalLLMCallSchema.parse({
      id: callId,
      projectId,
      stepId,
      chatId,
      requestHeaders: {
        "content-type": "application/json",
        "x-stagehand-request-id": "req_123",
      },
      requestBody: {
        model: "openai/gpt-5-nano",
      },
      responseBody: {
        output: [
          {
            type: "text",
            text: "done",
          },
        ],
      },
      errorBody: null,
      usage: {
        inputTokens: 10,
        outputTokens: 4,
      },
      modelName: "openai/gpt-5-nano",
      startedAt: timestamp,
      completedAt: timestamp,
    });

    const stepOnlyCall = InternalLLMCallSchema.parse({
      ...call,
      id: "0195c7c6-7b81-7b4e-90b0-d8fd25897777",
      chatId: null,
    });

    assert.equal(call.stepId, stepId);
    assert.equal(call.chatId, chatId);
    assert.equal(stepOnlyCall.chatId, null);
  });
});
