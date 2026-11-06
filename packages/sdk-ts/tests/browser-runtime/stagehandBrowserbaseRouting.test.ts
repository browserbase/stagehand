import type { IncomingHttpHeaders, Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import type { JSONRPCMessage } from "@browserbasehq/stagehand-protocol/json-rpc/types";
import type { LLMGenerateParams, LLMGenerateResult } from "@browserbasehq/stagehand-protocol/types";
import { Stagehand, type StagehandBrowser } from "../../src/index.js";
import { createBrowserFactoriesForTest } from "../../src/browser/factories.js";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import { CDPClient } from "../../src/cdpClient.js";
import { STAGEHAND_EXTENSION_DIRECTORY_PATH } from "../../src/extensionAssets.js";

import { createHttpTestServer, listen, close } from "../helpers/httpServer.js";

import fixture from "../../../../tests/fixtures/browserbase-routing.json" with { type: "json" };

const answerSchema = z.object({ answer: z.number() });
const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
const valueFor = (name?: string): Record<string, string | number | boolean> =>
  name === "Metadata" ? { progress: "Complete", completed: true } : { answer: 42 };
const customGenerate = vi.fn(async (input: LLMGenerateParams): Promise<LLMGenerateResult> => {
  const value = valueFor(
    input.responseFormat?.type === "json_schema" ? input.responseFormat.name : undefined,
  );
  return {
    role: "assistant",
    content: { type: "text", text: JSON.stringify(value) },
    outputFormat: "json_schema",
    structuredContent: value,
    usage,
  };
});
let server: Server;
let origin: string;
let chrome: Awaited<ReturnType<typeof launchLocalBrowser>>;
let browser: StagehandBrowser;
let stagehand: Stagehand | undefined;
let cdp: CDPClient;
const sent: JSONRPCMessage[] = [];
const requests: { path: string; body: Record<string, unknown>; headers: IncomingHttpHeaders }[] =
  [];
let hit = false;
let cacheFailure = false;

beforeAll(async () => {
  server = createHttpTestServer((req, res) => {
    if (req.url === "/page") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body><h1>Answer: 42</h1></body></html>");
      return;
    }
    if (!req.url?.startsWith("/services/v1/")) {
      res.writeHead(404);
      res.end();
      return;
    }
    const body = JSON.parse(req.body) as Record<string, unknown>;
    requests.push({ path: req.url!, body, headers: req.headers });
    if (req.url?.includes("/cache/") && cacheFailure) {
      res.writeHead(503);
      res.end("cache unavailable");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url?.endsWith("/responses")) {
      const text = body.text as { format: { name: string } };
      res.end(JSON.stringify(text.format.name === "Metadata" ? fixture.metadata : fixture.gateway));
    } else {
      res.end(
        JSON.stringify(
          req.url?.endsWith("/cache/get")
            ? hit
              ? fixture.cacheHit
              : fixture.cacheMiss
            : fixture.cacheSet,
        ),
      );
    }
  });
  origin = await listen(server);
  chrome = await launchLocalBrowser({ headless: true }, AbortSignal.timeout(60000));
  // Session acquisition uses a local fixture; CDP, the worker, and SDK HTTP are real.
  const factories = createBrowserFactoriesForTest({
    createBrowserbaseSessionClient: () => ({
      createSession: vi.fn(),
      connectSession: async () => ({
        sessionId: "session-routing",
        cdpUrl: chrome.cdpUrl,
        region: "eu-central-1",
        close: async () => {},
      }),
    }),
    connectCdp: async (options) => {
      cdp = await CDPClient.connect({
        ...options,
        preloadedExtension: undefined,
        extensionDir: STAGEHAND_EXTENSION_DIRECTORY_PATH,
      });
      const send = cdp.send.bind(cdp);
      vi.spyOn(cdp, "send").mockImplementation(async (message) => {
        sent.push(message);
        await send(message);
      });
      return cdp;
    },
  });
  browser = await factories.browserbase.connect({
    apiKey: "bb-browser-routing",
    sessionId: "session-routing",
  });
}, 70000);
beforeEach(() => {
  requests.length = sent.length = 0;
  hit = cacheFailure = false;
  customGenerate.mockClear();
});
afterEach(async () => {
  await stagehand?.close();
  stagehand = undefined;
});
afterAll(async () => {
  await browser?.close();
  await chrome?.close();
  vi.restoreAllMocks();
  if (server) await close(server);
});
async function create(
  model?: { generate: typeof customGenerate } | { modelName: "openai/gpt-5"; apiKey: string },
) {
  stagehand = await Stagehand.create({
    browser,
    apiKey: "bb-stagehand-routing",
    apiUrl: `${origin}/services`,
    model,
    logging: { level: "off" },
  });
  const page = await browser.context.newPage();
  await page.goto(`${origin}/page`);
  await browser.context.setActivePage(page);
  return stagehand;
}

describe("TypeScript Browserbase routing in Chromium", () => {
  it("runs ordinary and batch Gateway/cache calls through the connected SDK", async () => {
    const client = await create();
    const initialized = sent.find(
      (message) => "method" in message && message.method === "stagehand.init",
    );
    expect(initialized).toMatchObject({
      params: {
        browserbase: "client",
        browser: { session_id: "session-routing", region: "eu-central-1" },
      },
    });
    expect((initialized as { params: object }).params).not.toHaveProperty("api_key");
    expect((initialized as { params: object }).params).not.toHaveProperty("api_url");
    expect(JSON.stringify(initialized)).not.toContain("bb-browser-routing");
    expect(JSON.stringify(initialized)).not.toContain("bb-stagehand-routing");
    expect(await client.extract("Extract the answer", answerSchema)).toMatchObject({
      data: { answer: 42 },
      metadata: { cache: { status: "MISS" } },
    });
    expect(
      await client.experimentalBatch(async (batch) =>
        batch.extract("Extract the answer", {
          type: "object",
          properties: { answer: { type: "number" } },
          required: ["answer"],
          additionalProperties: false,
        }),
      ),
    ).toMatchObject({ data: { answer: 42 } });
    expect(requests.map((request) => request.path)).toEqual(
      Array(2)
        .fill([
          "/services/v1/cache/get",
          "/services/v1/llm/responses",
          "/services/v1/llm/responses",
          "/services/v1/cache/set",
        ])
        .flat(),
    );
    for (const request of requests) {
      expect(request.headers["x-bb-api-key"]).toBe("bb-browser-routing");
      if (request.path.endsWith("/responses")) {
        expect(request.headers["x-bb-session-id"]).toBe("session-routing");
        expect(request.body).not.toHaveProperty("model");
      }
    }
  });

  it("uses the custom client inside batch and replaces it with an explicit Gateway override", async () => {
    const client = await create({ generate: customGenerate });
    await client.experimentalBatch(async (batch) =>
      batch.extract("Extract the answer", {
        type: "object",
        properties: { answer: { type: "number" } },
        required: ["answer"],
        additionalProperties: false,
      }),
    );
    expect(customGenerate).toHaveBeenCalledTimes(2);
    expect(requests.map((request) => request.path)).toEqual([
      "/services/v1/cache/get",
      "/services/v1/cache/set",
    ]);
    await client.extract("Extract the answer", answerSchema, {
      model: { modelName: "anthropic/claude-sonnet-4-6" },
    });
    expect(customGenerate).toHaveBeenCalledTimes(2);
    await client.experimentalBatch(async (batch) =>
      batch.extract(
        "Extract the answer",
        {
          type: "object",
          properties: { answer: { type: "number" } },
          required: ["answer"],
          additionalProperties: false,
        },
        { model: { modelName: "anthropic/claude-sonnet-4-6" } },
      ),
    );
    expect(customGenerate).toHaveBeenCalledTimes(2);
    const gateway = requests.filter((request) => request.path.endsWith("/responses"));
    expect(gateway).toHaveLength(4);
    expect(gateway.every((request) => request.body.model === "anthropic/claude-sonnet-4-6")).toBe(
      true,
    );
  });

  it("falls back from failed cache HTTP to the custom client", async () => {
    const client = await create({ generate: customGenerate });
    cacheFailure = true;
    expect(await client.extract("Extract the answer", answerSchema)).toMatchObject({
      data: { answer: 42 },
      metadata: { cache: { status: "MISS", missReason: "read_failed" } },
    });
    expect(customGenerate).toHaveBeenCalledTimes(2);
    expect(requests).toHaveLength(2);
  });

  it("preserves direct model settings while a cache hit skips inference", async () => {
    const client = await create({ modelName: "openai/gpt-5", apiKey: "provider-routing" });
    hit = true;
    expect(
      sent.find((message) => "method" in message && message.method === "stagehand.init"),
    ).toMatchObject({ params: { model: { api_key: "provider-routing" } } });
    expect(await client.extract("Extract the answer", answerSchema)).toMatchObject({
      data: { answer: 7 },
      metadata: { cache: { status: "HIT" } },
    });
    expect(requests.map((request) => request.path)).toEqual(["/services/v1/cache/get"]);
  });
});
