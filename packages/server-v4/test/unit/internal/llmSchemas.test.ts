import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  InternalLLMCallSchema,
  InternalLLMSessionSchema,
  InternalStagehandBrowserSessionSchema,
  InternalStagehandStepSchema,
} from "../../../src/schemas/internal/index.js";

const projectId = "550e8400-e29b-41d4-a716-446655440000";
const browserSessionId = "0195c7c6-7b75-7e9e-98a2-f3b999c4aa11";
const defaultLLMSessionId = "0195c7c6-7b73-7002-b735-3471f4f0b8b0";
const copiedTemplateId = "0195c7c6-7b71-7ed1-8ac5-8f8f7f318cc7";
const forkedSessionId = "0195c7c6-7b72-7339-91d0-b42c0339f0af";
const stepId = "0195c7c6-7b76-7db4-8128-445ea7c81122";
const llmCallId = "0195c7c6-7b74-75df-b8b4-42e50979d001";
const timestamp = "2026-02-03T12:00:00.000Z";

describe("internal llm session data model schemas", () => {
  it("stores a browser session with a default llm session reference", () => {
    const browserSession = InternalStagehandBrowserSessionSchema.parse({
      id: browserSessionId,
      projectId,
      browserbaseSessionId: null,
      cdpUrl: "ws://localhost:9222/devtools/browser/example",
      status: "running",
      defaultLLMSessionId,
    });

    assert.equal(browserSession.defaultLLMSessionId, defaultLLMSessionId);
    assert.equal(browserSession.status, "running");
  });

  it("stores llm sessions with config, lifecycle state, lineage, and usage aggregates", () => {
    const llmSession = InternalLLMSessionSchema.parse({
      id: defaultLLMSessionId,
      copiedTemplateId,
      forkedSessionId,
      projectId,
      browserSessionId,
      createdAt: timestamp,
      updatedAt: timestamp,
      connectedAt: timestamp,
      disconnectedAt: null,
      lastRequestAt: timestamp,
      lastResponseAt: timestamp,
      lastErrorAt: null,
      lastErrorMessage: null,
      status: "idle",
      model: "openai/gpt-5-nano",
      baseUrl: "https://api.openai.com/v1",
      options: {
        temperature: 0.2,
        maxTokens: 1000,
      },
      extraHttpHeaders: {
        Authorization: "Bearer stub-token",
      },
      systemPrompt: "Be precise.",
      tokensInput: 10,
      tokensOutput: 5,
      tokensReasoning: 3,
      tokensCachedInput: 1,
      tokensTotal: 19,
    });

    assert.equal(llmSession.copiedTemplateId, copiedTemplateId);
    assert.equal(llmSession.forkedSessionId, forkedSessionId);
    assert.equal(llmSession.model, "openai/gpt-5-nano");
    assert.equal(llmSession.tokensTotal, 19);
  });

  it("stores a single call row containing request, response, error, usage, and model snapshot", () => {
    const llmCall = InternalLLMCallSchema.parse({
      id: llmCallId,
      llmSessionId: defaultLLMSessionId,
      sentAt: timestamp,
      receivedAt: timestamp,
      prompt: "Click the primary button.",
      expectedResponseSchema: {
        type: "object",
        properties: {
          elementId: { type: "string" },
        },
      },
      response: {
        elementId: "12-4",
        method: "click",
      },
      error: null,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
      },
      model: "openai/gpt-5-nano",
    });

    assert.equal(llmCall.llmSessionId, defaultLLMSessionId);
    assert.equal(llmCall.model, "openai/gpt-5-nano");
    assert.equal(
      (llmCall.response as Record<string, unknown>).elementId,
      "12-4",
    );
  });

  it("stores a stagehand step that resolves from a template to a dedicated llm session", () => {
    const step = InternalStagehandStepSchema.parse({
      id: stepId,
      stagehandBrowserSessionId: browserSessionId,
      operation: "act",
      llmTemplateId: defaultLLMSessionId,
      llmSessionId: forkedSessionId,
      params: {
        instruction: "click the primary button",
      },
      result: {
        success: true,
      },
    });

    assert.equal(step.llmTemplateId, defaultLLMSessionId);
    assert.equal(step.llmSessionId, forkedSessionId);
    assert.equal(step.operation, "act");
  });
});
