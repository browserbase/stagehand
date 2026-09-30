import { describe, expect, it } from "vitest";
import {
  addTokenUsage,
  inspectModelRequest,
  parseProviderResponseUsage,
  sumTokenUsage,
  toTokenUsage,
  unexpectedTools,
} from "../src/index.js";

describe("token usage sums", () => {
  it("adds every bucket across steps", () => {
    expect(
      sumTokenUsage([
        {
          promptTokens: 100,
          completionTokens: 10,
          totalTokens: 110,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 90,
        },
        {
          promptTokens: 120,
          completionTokens: 12,
          totalTokens: 132,
          cachedInputTokens: 90,
          cacheCreationInputTokens: 20,
          reasoningTokens: 5,
        },
      ]),
    ).toEqual({
      promptTokens: 220,
      completionTokens: 22,
      totalTokens: 242,
      cachedInputTokens: 90,
      cacheCreationInputTokens: 110,
      reasoningTokens: 5,
    });
  });

  it("keeps a bucket no step reported absent, and an observed zero as zero", () => {
    const sum = sumTokenUsage([
      { promptTokens: 10, completionTokens: 1, totalTokens: 11, cachedInputTokens: 0 },
      { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
    ]);
    expect(sum?.cachedInputTokens).toBe(0);
    expect(sum).not.toHaveProperty("cacheCreationInputTokens");
    expect(sum).not.toHaveProperty("reasoningTokens");
  });

  it("returns undefined for no steps", () => {
    expect(sumTokenUsage([])).toBeUndefined();
  });

  it("carries a previously reported bucket through a step that omits it", () => {
    const first = addTokenUsage(undefined, {
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      cacheCreationInputTokens: 7,
    });
    expect(
      addTokenUsage(first, { promptTokens: 1, completionTokens: 1, totalTokens: 2 }),
    ).toMatchObject({
      cacheCreationInputTokens: 7,
    });
  });

  it("picks protocol fields off a mastracode TokenUsage and drops raw", () => {
    expect(
      toTokenUsage({
        promptTokens: 5,
        completionTokens: 2,
        totalTokens: 7,
        cachedInputTokens: 3,
        raw: { x: 1 },
      }),
    ).toEqual({ promptTokens: 5, completionTokens: 2, totalTokens: 7, cachedInputTokens: 3 });
    expect(toTokenUsage(null)).toBeUndefined();
  });
});

describe("inspectModelRequest", () => {
  it("reads Anthropic tools and counts cache breakpoints", () => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-6",
      system: [{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }],
        },
      ],
      tools: [{ name: "stagehand_run" }, { name: "web_search", type: "web_search_20250305" }],
    });
    expect(inspectModelRequest("https://api.anthropic.com/v1/messages", body)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      toolNames: ["stagehand_run", "web_search"],
      cacheBreakpoints: 2,
    });
  });

  it("reads OpenAI function and provider tools", () => {
    const body = JSON.stringify({
      model: "gpt-5.4",
      input: [],
      tools: [
        { type: "function", name: "stagehand_run" },
        { type: "web_search" },
        { type: "function", function: { name: "x" } },
      ],
    });
    expect(inspectModelRequest("https://api.openai.com/v1/responses", body)?.toolNames).toEqual([
      "stagehand_run",
      "web_search",
      "x",
    ]);
  });

  it("ignores non-model traffic", () => {
    expect(inspectModelRequest("https://api.anthropic.com/v1/messages", undefined)).toBeUndefined();
    expect(inspectModelRequest("https://example.com/telemetry", '{"model":"x"}')).toBeUndefined();
    expect(
      inspectModelRequest("https://api.anthropic.com/v1/messages", "{not json"),
    ).toBeUndefined();
    expect(inspectModelRequest("not a url", '{"model":"x"}')).toBeUndefined();
  });

  it("records Gemini generateContent calls instead of dropping them", () => {
    expect(
      inspectModelRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse",
        '{"contents":[{"role":"user","parts":[{"text":"title this"}]}]}',
      ),
    ).toEqual({
      provider: "google",
      model: "google/gemini-3.5-flash",
      toolNames: [],
      cacheBreakpoints: 0,
    });
    expect(
      inspectModelRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
        JSON.stringify({
          tools: [
            { functionDeclarations: [{ name: "stagehand_run" }, { name: "x" }] },
            { googleSearch: {} },
          ],
        }),
      )?.toolNames,
    ).toEqual(["stagehand_run", "x", "googleSearch"]);
  });

  it("records a Bedrock call as provider other, even with an unparsed body", () => {
    expect(
      inspectModelRequest(
        "https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-haiku/converse-stream",
        "not json",
      ),
    ).toEqual({
      provider: "other",
      model: "bedrock/anthropic.claude-haiku",
      toolNames: [],
      cacheBreakpoints: 0,
    });
  });

  it("lists offered tools outside the allowlist once", () => {
    expect(unexpectedTools(["a", "b", "b", "c"], ["a"])).toEqual(["b", "c"]);
    expect(unexpectedTools([], ["a"])).toEqual([]);
  });
});

describe("parseProviderResponseUsage", () => {
  it("reads an Anthropic SSE stream as whole-prompt input", () => {
    const stream = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":50,"cache_read_input_tokens":4000,"cache_creation_input_tokens":300,"output_tokens":1}}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":42}}',
    ].join("\n\n");
    expect(parseProviderResponseUsage("anthropic", stream)).toEqual({
      inputTokens: 4350,
      cachedInputTokens: 4000,
      cacheCreationInputTokens: 300,
      outputTokens: 42,
    });
  });

  it("reads a non-streamed Anthropic response", () => {
    expect(
      parseProviderResponseUsage(
        "anthropic",
        '{"id":"m","usage":{"input_tokens":9,"cache_read_input_tokens":0,"output_tokens":3}}',
      ),
    ).toEqual({
      inputTokens: 9,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 3,
    });
  });

  it("reads OpenAI Responses completion usage", () => {
    const stream =
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":1000,"input_tokens_details":{"cached_tokens":800},"output_tokens":20}}}\n\ndata: [DONE]';
    expect(parseProviderResponseUsage("openai", stream)).toEqual({
      inputTokens: 1000,
      cachedInputTokens: 800,
      cacheCreationInputTokens: 0,
      outputTokens: 20,
    });
  });

  it("reads Gemini usageMetadata from an SSE stream or a JSON array", () => {
    const stream = [
      'data: {"candidates":[],"usageMetadata":{"promptTokenCount":900,"candidatesTokenCount":1}}',
      'data: {"candidates":[],"usageMetadata":{"promptTokenCount":900,"cachedContentTokenCount":600,"candidatesTokenCount":12,"thoughtsTokenCount":8}}',
    ].join("\n\n");
    expect(parseProviderResponseUsage("google", stream)).toEqual({
      inputTokens: 900,
      cachedInputTokens: 600,
      cacheCreationInputTokens: 0,
      outputTokens: 20,
    });
    expect(
      parseProviderResponseUsage(
        "google",
        '[{"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":2}}]',
      ),
    ).toMatchObject({ inputTokens: 10, outputTokens: 2 });
  });

  it("never parses usage for provider other", () => {
    expect(parseProviderResponseUsage("other", '{"usage":{"input_tokens":5}}')).toBeUndefined();
  });

  it("returns undefined when the body carries no usage", () => {
    expect(parseProviderResponseUsage("anthropic", "data: {}\n\n")).toBeUndefined();
    expect(parseProviderResponseUsage("anthropic", "{broken")).toBeUndefined();
  });
});
