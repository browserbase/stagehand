import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  InternalBrowserSessionSchema,
  InternalLLMChatSchema,
  InternalLLMConfigSchema,
  InternalUIMessageSchema,
  resolveInternalLLMConfigId,
} from "../../../src/schemas/internal/index.js";

const projectId = "550e8400-e29b-41d4-a716-446655440000";
const configId = "0195c7c6-7b71-7ed1-8ac5-8f8f7f318cc7";
const actConfigId = "0195c7c6-7b72-7339-91d0-b42c0339f0af";
const browserSessionId = "0195c7c6-7b74-75df-b8b4-42e50979d001";
const primaryChatId = "0195c7c6-7b75-7e9e-98a2-f3b999c4aa11";
const secondaryChatId = "0195c7c6-7b77-763e-bf87-efcc5ccf2233";
const timestamp = "2026-02-03T12:00:00.000Z";

describe("internal llm data model schemas", () => {
  it("stores per-operation config refs and a primary chat on the browser session", () => {
    const browserSession = InternalBrowserSessionSchema.parse({
      id: browserSessionId,
      projectId,
      env: "LOCAL",
      status: "running",
      browserbaseSessionId: null,
      cdpUrl: "ws://localhost:9222/devtools/browser/example",
      primaryChatId,
      defaultLlmConfigId: configId,
      actLlmConfigId: actConfigId,
      observeLlmConfigId: null,
      extractLlmConfigId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      endedAt: null,
    });

    assert.equal(
      resolveInternalLLMConfigId(browserSession, "act"),
      actConfigId,
    );
    assert.equal(
      resolveInternalLLMConfigId(browserSession, "observe"),
      configId,
    );
    assert.equal(
      resolveInternalLLMConfigId(browserSession, "extract"),
      configId,
    );
    assert.equal(browserSession.primaryChatId, primaryChatId);
  });

  it("allows a browser session to own multiple chats", () => {
    const primaryChat = InternalLLMChatSchema.parse({
      id: primaryChatId,
      projectId,
      browserSessionId,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastMessageAt: timestamp,
    });

    const secondaryChat = InternalLLMChatSchema.parse({
      id: secondaryChatId,
      projectId,
      browserSessionId,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastMessageAt: null,
    });

    assert.equal(primaryChat.browserSessionId, secondaryChat.browserSessionId);
    assert.notEqual(primaryChat.id, secondaryChat.id);
  });

  it("stores llm configs as reusable config resources", () => {
    const config = InternalLLMConfigSchema.parse({
      id: configId,
      projectId,
      source: "user",
      displayName: "Primary config",
      modelName: "openai/gpt-5-nano",
      baseUrl: "https://api.openai.com/v1",
      systemPrompt: "Be precise.",
      providerOptions: {
        temperature: 0.2,
        topP: 1,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    assert.equal(config.modelName, "openai/gpt-5-nano");
    assert.equal(config.source, "user");
    assert.equal(
      (config.providerOptions as Record<string, unknown>).temperature,
      0.2,
    );
  });

  it("stores messages as ai-sdk-style parts with optional metadata", () => {
    const message = InternalUIMessageSchema.parse({
      id: "0195c7c6-7b79-7fbb-a49f-4b994a1c5555",
      projectId,
      chatId: primaryChatId,
      role: "assistant",
      parts: [
        {
          type: "step-start",
        },
        {
          type: "reasoning",
          text: "Looking for the primary action target.",
          state: "done",
          providerMetadata: {
            openai: {
              effort: "medium",
            },
          },
        },
        {
          type: "text",
          text: "Click the primary button.",
          state: "done",
        },
        {
          type: "tool-click",
          toolCallId: "tool_123",
          state: "output-available",
          input: { selector: "button.primary" },
          output: { success: true },
        },
        {
          type: "data-stagehand-action",
          id: "data_123",
          data: {
            selector: "button.primary",
            status: "completed",
          },
        },
        {
          type: "source-url",
          sourceId: "source_123",
          url: "https://example.com/docs",
          title: "Example docs",
        },
      ],
      metadata: {
        providerMessageId: "msg_01JXAMPLE",
        providerResponseId: "resp_01JXAMPLE",
        modelName: "openai/gpt-5-nano",
        finishReason: "stop",
        totalTokens: 42,
      },
      sequence: 1,
      createdAt: timestamp,
    });

    assert.equal(message.parts.length, 6);
    assert.equal(
      (message.metadata as Record<string, unknown>).providerResponseId,
      "resp_01JXAMPLE",
    );
  });
});
