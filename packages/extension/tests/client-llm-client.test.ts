import { describe, expect, it, vi } from "vitest";
import { STAGEHAND_PROTOCOL_VERSION } from "@browserbasehq/stagehand-protocol/schemas";
import { generateWithClientLlm } from "../llm/clientLlmClient.js";
import * as llmService from "../services/llmService.js";
import { createStagehandRuntime } from "../runtime.js";

describe("client LLM generation", () => {
  it("forwards a worker LLM request to the connected SDK", async () => {
    const request = vi.fn(async () => ({
      role: "assistant" as const,
      content: { type: "text" as const, text: "Four" },
      outputFormat: "text" as const,
    }));
    await expect(
      generateWithClientLlm(request, {
        messages: [{ role: "user", content: { type: "text", text: "What is 2 + 2?" } }],
      }),
    ).resolves.toMatchObject({
      content: { type: "text", text: "Four" },
    });
    expect(request).toHaveBeenCalledWith({
      messages: [{ role: "user", content: { type: "text", text: "What is 2 + 2?" } }],
    });
  });

  it("routes client-side generation through the LLM service", async () => {
    const request = vi.fn(async () => ({
      role: "assistant" as const,
      content: { type: "text" as const, text: "Four" },
      outputFormat: "text" as const,
    }));

    await expect(
      llmService.generate(
        { source: "client" },
        {
          messages: [{ role: "user", content: { type: "text", text: "What is 2 + 2?" } }],
        },
        request,
      ),
    ).resolves.toMatchObject({
      content: { type: "text", text: "Four" },
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("uses the connected SDK callback for an initialized client model", async () => {
    const request = vi.fn(async () => ({
      role: "assistant" as const,
      content: { type: "text" as const, text: "Four" },
      outputFormat: "text" as const,
    }));
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => ({
        connected: true,
        pages: () => [],
        activePage: async () => undefined,
        setActivePage: async () => {},
        addInitScript: async () => {},
        setExtraHTTPHeaders: async () => {},
        getDomainPolicy: () => null,
        setDomainPolicy: async () => {},
        cookies: async () => [],
        addCookies: async () => {},
        clearCookies: async () => {},
        clipboard: {
          readText: async () => "",
          writeText: async () => {},
          clear: async () => {},
          paste: async () => {},
          copy: async () => {},
          cut: async () => {},
        },
        newPage: async () => {
          throw new Error("Not used by this test");
        },
        close: async () => {},
      }),
      clientLLMGenerate: request,
    });

    await runtime.replaceBrowserConnection({
      cdpUrl: "ws://browser.example",
    });
    await runtime.initialize({
      protocolVersion: STAGEHAND_PROTOCOL_VERSION,
      clientInfo: { name: "stagehand-sdk-test", version: "1.0.0" },
      logLevel: "info",
      model: { source: "client" },
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    });

    await runtime.generateLlm({
      messages: [{ role: "user", content: { type: "text", text: "What is 2 + 2?" } }],
    });

    expect(request).toHaveBeenCalledOnce();
  });
});
