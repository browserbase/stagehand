import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import {
  llmConfigInsertSchema,
  llmConfigUpdateSchema,
} from "../../../src/db/schema/zod.js";
import { InternalLLMSessionSchema } from "../../../src/schemas/internal/index.js";
import { BrowserSessionCreateRequestSchema } from "../../../src/schemas/v4/browserSession.js";
import {
  LLMCreateRequestSchema,
  LLMIdSchema,
  LLMSchema,
  LLMUpdateRequestSchema,
} from "../../../src/schemas/v4/llm.js";

describe("server-v4 db-derived zod contracts", () => {
  it("requires modelName in the generated llm config insert schema", () => {
    const result = llmConfigInsertSchema.safeParse({
      source: "user",
    });

    assert.equal(result.success, false);
  });

  it("derives the public create/update schemas from the db schemas without writable id fields", () => {
    const createResult = LLMCreateRequestSchema.safeParse({
      id: randomUUID(),
      modelName: "openai/gpt-4.1-nano",
    });
    const updateResult = LLMUpdateRequestSchema.safeParse({
      id: randomUUID(),
    });

    assert.equal(createResult.success, false);
    assert.equal(updateResult.success, false);
    assert.equal(
      llmConfigUpdateSchema.safeParse({
        modelName: "openai/gpt-4.1-nano",
      }).success,
      true,
    );
  });

  it("uses uuid-backed public llm ids consistently across llm and browser session schemas", () => {
    const llmId = randomUUID();

    assert.equal(LLMIdSchema.safeParse(llmId).success, true);
    assert.equal(LLMIdSchema.safeParse("llm_01JXAMPLE").success, false);
    assert.equal(
      BrowserSessionCreateRequestSchema.safeParse({
        env: "LOCAL",
        llmId,
        cdpUrl: "ws://localhost:9222/devtools/browser/example",
      }).success,
      true,
    );
    assert.equal(
      BrowserSessionCreateRequestSchema.safeParse({
        env: "LOCAL",
        llmId: "llm_01JXAMPLE",
        cdpUrl: "ws://localhost:9222/devtools/browser/example",
      }).success,
      false,
    );
  });

  it("keeps nullable db fields nullable in the public llm response schema", () => {
    const llm = LLMSchema.parse({
      id: randomUUID(),
      source: "user",
      displayName: null,
      modelName: "openai/gpt-4.1-nano",
      baseUrl: null,
      systemPrompt: null,
      providerOptions: null,
      createdAt: "2026-02-03T12:00:00.000Z",
      updatedAt: "2026-02-03T12:00:00.000Z",
    });

    assert.equal(llm.displayName, null);
    assert.equal(llm.baseUrl, null);
    assert.equal(llm.systemPrompt, null);
    assert.equal(llm.providerOptions, null);
  });

  it("allows internal llm sessions without a browser session binding", () => {
    const session = InternalLLMSessionSchema.parse({
      id: randomUUID(),
      copiedTemplateId: null,
      forkedSessionId: null,
      projectId: randomUUID(),
      browserSessionId: null,
      createdAt: "2026-02-03T12:00:00.000Z",
      updatedAt: "2026-02-03T12:00:00.000Z",
      connectedAt: null,
      disconnectedAt: null,
      lastRequestAt: null,
      lastResponseAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      status: "idle",
      model: "openai/gpt-4.1-nano",
      baseUrl: null,
      options: null,
      extraHttpHeaders: null,
      systemPrompt: null,
      tokensInput: 0,
      tokensOutput: 0,
      tokensReasoning: 0,
      tokensCachedInput: 0,
      tokensTotal: 0,
    });

    assert.equal(session.browserSessionId, null);
  });
});
