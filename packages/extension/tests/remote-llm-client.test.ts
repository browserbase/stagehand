import { describe, expect, it, vi } from "vite-plus/test";
import { RemoteLLMClient } from "../llm/remoteLlmClient.js";
import { createStagehandRuntime } from "../runtime.js";

describe("RemoteLLMClient", () => {
  it("forwards a worker LLM request to the connected SDK", async () => {
    const request = vi.fn(async () => ({
      role: "assistant" as const,
      content: { type: "text" as const, text: "Four" },
      model: "openai/gpt-5" as const,
      outputFormat: "text" as const,
    }));
    const client = new RemoteLLMClient("openai/gpt-5", request);

    await expect(
      client.generate({
        messages: [{ role: "user", content: { type: "text", text: "What is 2 + 2?" } }],
      }),
    ).resolves.toMatchObject({
      content: { type: "text", text: "Four" },
      model: "openai/gpt-5",
    });
    expect(request).toHaveBeenCalledWith({
      messages: [{ role: "user", content: { type: "text", text: "What is 2 + 2?" } }],
    });
  });

  it("uses the connected SDK callback for an initialized client model", async () => {
    const request = vi.fn(async () => ({
      role: "assistant" as const,
      content: { type: "text" as const, text: "Four" },
      model: "openai/gpt-5" as const,
      outputFormat: "text" as const,
    }));
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => ({
        connected: true,
        getVersion: async () => ({}),
        pages: () => [],
        newPage: async () => {
          throw new Error("Not used by this test");
        },
        close: async () => {},
      }),
      clientLLMGenerate: request,
    });

    await runtime.configureLoopback({
      cdpUrl: "ws://browser.example",
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    });
    await runtime.initialize({
      cdpUrl: "ws://browser.example",
      model: { source: "client", modelName: "openai/gpt-5" },
    });

    await runtime.clientLLM?.generate({
      messages: [{ role: "user", content: { type: "text", text: "What is 2 + 2?" } }],
    });

    expect(request).toHaveBeenCalledOnce();
  });
});
