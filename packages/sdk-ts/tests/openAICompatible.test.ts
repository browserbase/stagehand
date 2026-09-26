import { afterEach, describe, expect, it, vi } from "vitest";
import type { LLMGenerateParams } from "@browserbasehq/stagehand-protocol/types";
import { openAICompatible } from "../src/openAICompatible.js";

const params: LLMGenerateParams = {
  messages: [
    { role: "user", content: { type: "text", text: "click the login button" } },
    {
      role: "user",
      content: [
        { type: "text", text: "what is on screen?" },
        { type: "image", data: "abc", mimeType: "image/png" },
      ],
    },
  ],
  systemPrompt: "You browse the web.",
  temperature: 0,
  responseFormat: {
    type: "json_schema",
    name: "act",
    schema: { type: "object" },
  },
};

const livePng1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("openAICompatible", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts Chat Completions and returns structured content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ action: "click" }) } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const model = openAICompatible({
      model: "xiaomi/mimo-v2.6-pro",
      baseURL: "https://ai-gateway.vercel.sh/v1/",
      apiKey: "test-key",
      headers: { "x-gateway": "1" },
    });

    await expect(model.generate(params)).resolves.toEqual({
      role: "assistant",
      content: { type: "text", text: JSON.stringify({ action: "click" }) },
      outputFormat: "json_schema",
      structuredContent: { action: "click" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ai-gateway.vercel.sh/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-gateway")).toBe("1");

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
      response_format: { type: string; json_schema: { name: string; strict: boolean } };
    };
    expect(body.model).toBe("xiaomi/mimo-v2.6-pro");
    expect(body.messages[0]).toEqual({ role: "system", content: "You browse the web." });
    expect(body.messages[1]).toEqual({ role: "user", content: "click the login button" });
    expect(body.messages[2]?.content).toEqual([
      { type: "text", text: "what is on screen?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
    ]);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "act", schema: { type: "object" }, strict: true },
    });
  });

  it("merges extraBody into the payload without overriding model or messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const model = openAICompatible({
      model: "openai/gpt-6-luna",
      baseURL: "https://ai-gateway.vercel.sh/v1",
      apiKey: "test-key",
      extraBody: {
        model: "should-not-win",
        providerOptions: {
          gateway: {
            user: "user-12345",
            tags: ["team:billing", "env:prod"],
          },
        },
        seed: 42,
      },
    });

    await model.generate(params);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ai-gateway.vercel.sh/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      model: string;
      seed: number;
      providerOptions: { gateway: { user: string; tags: string[] } };
    };
    expect(body.model).toBe("openai/gpt-6-luna");
    expect(body.seed).toBe(42);
    expect(body.providerOptions).toEqual({
      gateway: {
        user: "user-12345",
        tags: ["team:billing", "env:prod"],
      },
    });
  });

  it("surfaces a non-OK gateway response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("model not found", { status: 404 })),
    );

    const model = openAICompatible({
      model: "missing",
      baseURL: "https://example.test/v1",
      apiKey: "test-key",
    });

    await expect(model.generate(params)).rejects.toThrow(
      "OpenAI-compatible request failed (404): model not found",
    );
  });

  it.runIf(Boolean(process.env.AI_GATEWAY_API_KEY))(
    "live: calls Vercel AI Gateway with gpt-6-luna and extraBody",
    async () => {
      const model = openAICompatible({
        model: process.env.AI_GATEWAY_MODEL || "openai/gpt-6-luna",
        baseURL: process.env.AI_GATEWAY_BASE_URL || "https://ai-gateway.vercel.sh/v1",
        apiKey: process.env.AI_GATEWAY_API_KEY!,
        extraBody: {
          providerOptions: {
            gateway: {
              user: "test-user-live-vitest",
              tags: ["smoke:vitest", "test:live-luna"],
            },
          },
        },
      });

      const res = await model.generate({
        messages: [
          { role: "user", content: { type: "text", text: "what is on screen?" } },
          {
            role: "user",
            content: [{ type: "image", data: livePng1x1, mimeType: "image/png" }],
          },
        ],
        responseFormat: {
          type: "json_schema",
          name: "observation",
          schema: {
            type: "object",
            properties: { status: { type: "string" } },
            required: ["status"],
            additionalProperties: false,
          },
        },
      });
      if (res.outputFormat !== "json_schema") {
        throw new Error(`expected json_schema, got ${res.outputFormat}`);
      }
      expect(res.structuredContent).toBeDefined();
    },
  );
});
