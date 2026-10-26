import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as llmService from "../services/llmService.js";
import type { GatewayContext } from "../llm/gatewayClient.js";

import { createBrowserbaseTestBridge } from "./helpers/browserbaseBridge.js";

interface CapturedRequest {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

let server: Server;
let gateway: GatewayContext;
let bridge: ReturnType<typeof createBrowserbaseTestBridge>;
let apiUrl: string;
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
  apiUrl = `http://127.0.0.1:${port}/v1`;
});

afterAll(() => {
  server.close();
});

afterEach(async () => {
  expect(bridge.requests).toHaveLength(requests.length);
  expect(bridge.requests.every(({ operation }) => operation === "gateway.responses")).toBe(true);
  bridge.rpc.close();
  await Promise.all(bridge.pendingReplies);
});

beforeEach(() => {
  bridge = createBrowserbaseTestBridge({ apiUrl, apiKey: "bb-api-key", sessionId: "session-123" });
  gateway = {
    request: bridge.runtime.adapters.clientBrowserbaseRequest,
  };
  requests.length = 0;
  respondWith = () => completion("Hello from the gateway");
});

describe("gateway inference end to end", () => {
  it("omits only the model when Browserbase should select it automatically", async () => {
    for (const model of [{ modelName: "openai/gpt-5" } as const, undefined]) {
      await llmService.generate(
        model,
        { messages: [{ role: "user", content: { type: "text", text: "Say hello" } }] },
        () => {
          throw new Error("client LLM must not be used on the gateway path");
        },
        gateway,
      );
    }

    const { model, ...body } = requests[0]!.body;
    expect(model).toBe("openai/gpt-5");
    expect(requests[1]!.body).toEqual(body);
    expect(requests[1]!.url).toBe("/v1/llm/responses");
    expect(requests[1]!.headers).toMatchObject({
      "x-bb-api-key": "bb-api-key",
      "x-bb-session-id": "session-123",
      authorization: "Bearer bb-api-key",
    });
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
    expect(request.body.text).toMatchObject({ format: { type: "json_schema", name: "greeting" } });

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
