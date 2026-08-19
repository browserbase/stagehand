import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as llmService from "../services/llmService.js";
import type { GatewayContext } from "../llm/gatewayClient.js";

/**
 * End-to-end test of the gateway inference path with nothing mocked: the real
 * AI SDK stack (generateText → @ai-sdk/openai responses model → fetch) runs
 * against a local HTTP server standing in for stagehand-api-v3's
 * POST /v1/llm/responses. Verifies the exact wire contract the server
 * expects — endpoint path, auth headers, Responses-format body — and that
 * Responses payloads map back into the Stagehand LLM result schema.
 */

interface CapturedRequest {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

let server: Server;
let gateway: GatewayContext;
const requests: CapturedRequest[] = [];
let respondWith: () => Record<string, unknown>;

const completion = (content: string) => ({
  id: "resp_e2e",
  object: "response",
  created_at: 1700000000,
  model: "openai/gpt-5",
  status: "completed",
  output: [
    {
      type: "message",
      id: "msg_1",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: content, annotations: [] }],
    },
  ],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
});

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      requests.push({
        url: req.url ?? "",
        headers: req.headers,
        body: JSON.parse(body) as Record<string, unknown>,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(respondWith()));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  gateway = {
    apiUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "bb-api-key",
    sessionId: "session-123",
  };
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  requests.length = 0;
  respondWith = () => completion("Hello from the gateway");
});

describe("gateway inference end to end", () => {
  it("omits the model when Browserbase should select it automatically", async () => {
    await llmService.generate(
      undefined,
      {
        messages: [{ role: "user", content: { type: "text", text: "Say hello" } }],
      },
      () => {
        throw new Error("client LLM must not be used on the gateway path");
      },
      gateway,
    );

    const request = requests[0]!;
    expect(request.url).toBe("/v1/llm/responses");
    expect(request.headers["x-bb-api-key"]).toBe("bb-api-key");
    expect(request.headers["x-bb-session-id"]).toBe("session-123");
    expect(request.body).not.toHaveProperty("model");
  });

  it("sends an OpenAI-format request to the gateway endpoint and maps the response back", async () => {
    const result = await llmService.generate(
      {
        modelName: "openai/gpt-5",
        headers: {
          "x-custom-header": "custom-value",
          "x-bb-api-key": "must-not-override-auth",
        },
      },
      {
        systemPrompt: "Answer concisely.",
        messages: [{ role: "user", content: { type: "text", text: "Say hello" } }],
      },
      () => {
        throw new Error("client LLM must not be used on the gateway path");
      },
      gateway,
    );

    const request = requests[0]!;
    expect(request.url).toBe("/v1/llm/responses");
    expect(request.headers["x-bb-api-key"]).toBe("bb-api-key");
    expect(request.headers["x-bb-session-id"]).toBe("session-123");
    expect(request.headers["x-custom-header"]).toBe("custom-value");
    expect(request.body.model).toBe("openai/gpt-5");
    expect(request.body.input).toEqual([
      { role: "system", content: "Answer concisely." },
      {
        role: "user",
        content: [{ type: "input_text", text: "Say hello" }],
      },
    ]);

    expect(result).toEqual({
      role: "assistant",
      content: { type: "text", text: "Hello from the gateway" },
      stopReason: "stop",
      outputFormat: "text",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
  });

  it("round-trips structured output through the gateway", async () => {
    respondWith = () => completion(JSON.stringify({ greeting: "hi" }));

    const result = await llmService.generate(
      { modelName: "openai/gpt-5" },
      {
        messages: [{ role: "user", content: { type: "text", text: "Greet me" } }],
        responseFormat: {
          type: "json_schema",
          name: "greeting",
          schema: {
            type: "object",
            properties: { greeting: { type: "string" } },
            required: ["greeting"],
            additionalProperties: false,
          },
        },
      },
      () => {
        throw new Error("client LLM must not be used on the gateway path");
      },
      gateway,
    );

    const request = requests[0]!;
    const text = request.body.text as { format?: { type: string } } | undefined;
    expect(text?.format?.type).toBe("json_schema");

    expect(result.outputFormat).toBe("json_schema");
    expect(result).toMatchObject({ structuredContent: { greeting: "hi" } });
  });

  it("forwards tools and tool choice in Responses format", async () => {
    await llmService.generate(
      { modelName: "openai/gpt-5" },
      {
        messages: [{ role: "user", content: { type: "text", text: "Check the weather" } }],
        tools: [
          {
            name: "get_weather",
            description: "Gets the weather",
            inputSchema: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        ],
        toolChoice: { mode: "required" },
      },
      () => {
        throw new Error("client LLM must not be used on the gateway path");
      },
      gateway,
    );

    const request = requests[0]!;
    expect(request.body.tools).toEqual([
      {
        type: "function",
        name: "get_weather",
        description: "Gets the weather",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ]);
    expect(request.body.tool_choice).toBe("required");
  });
});
