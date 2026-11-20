import { afterEach, describe, expect, it, vi } from "vitest";
import { boundFetch } from "../llm/boundFetch.js";
import * as llmService from "../services/llmService.js";
import fixtures from "../../../tests/fixtures/browserbase-transport.json" with { type: "json" };

vi.mock("../llm/boundFetch.js", () => ({ boundFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe("direct xAI Responses inference", () => {
  it("sends credentials, headers, images and structured output directly to xAI", async () => {
    vi.mocked(boundFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...fixtures.gateway.response,
          model: "grok-4.7",
          output: [
            {
              type: "message",
              id: "msg",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: '{"answer":"hello"}', annotations: [] }],
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const gatewayRequest = vi.fn();
    const result = await llmService.generate(
      { modelName: "xai/grok-4.7", apiKey: "xai-secret", headers: { "x-tenant": "test" } },
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image" },
              { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
            ],
          },
        ],
        responseFormat: {
          type: "json_schema",
          name: "Answer",
          schema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
            additionalProperties: false,
          },
        },
      },
      vi.fn(),
      { request: gatewayRequest },
    );
    if (result.outputFormat !== "json_schema") throw new Error("Expected structured output");
    expect(result.structuredContent).toEqual({ answer: "hello" });
    expect(gatewayRequest).not.toHaveBeenCalled();
    const [url, init] = vi.mocked(boundFetch).mock.calls[0]!;
    expect(url).toBe("https://api.x.ai/v1/responses");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer xai-secret");
    expect(new Headers(init?.headers).get("x-tenant")).toBe("test");
    if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(init.body)).toMatchObject({
      model: "grok-4.7",
      text: { format: { type: "json_schema" } },
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Describe this image" },
            { type: "input_image", image_url: "data:image/png;base64,aGVsbG8=" },
          ],
        },
      ],
    });
  });
  it("returns function tool calls for the agent loop", async () => {
    vi.mocked(boundFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...fixtures.gateway.response,
          model: "grok-4.7",
          output: [
            {
              type: "function_call",
              id: "fc_1",
              call_id: "call_1",
              name: "navigate",
              arguments: '{"url":"https://example.com"}',
              status: "completed",
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const result = await llmService.generate(
      { modelName: "xai/grok-4.7", apiKey: "xai-secret" },
      {
        messages: [{ role: "user", content: { type: "text", text: "Open example.com" } }],
        tools: [
          {
            name: "navigate",
            inputSchema: {
              type: "object",
              properties: {
                url: { type: "string" },
              },
              required: ["url"],
            },
          },
        ],
        toolChoice: { mode: "required" },
      },
      vi.fn(),
    );
    expect(result.content).toContainEqual({
      type: "tool_use",
      id: "call_1",
      name: "navigate",
      input: { url: "https://example.com" },
    });
    expect(result.stopReason).toBe("tool-calls");
    const [, init] = vi.mocked(boundFetch).mock.calls[0]!;
    if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(init.body)).toMatchObject({
      tools: [{ type: "function", name: "navigate" }],
      tool_choice: "required",
    });
  });
});
