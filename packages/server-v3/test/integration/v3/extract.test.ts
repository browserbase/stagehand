import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  assertEventExists,
  assertFetchOk,
  assertFetchStatus,
  assertWithContext,
  createSessionWithCdp,
  endSession,
  fetchWithContext,
  GEMINI_API_KEY,
  getBaseUrl,
  getHeaders,
  getMainFrameId,
  HTTP_OK,
  navigateSession,
  readTypedSSEStreamWithContext,
  requireEnv,
} from "../utils.js";

/** Result type for extract SSE events */
type ExtractResult = Record<string, unknown>;

type FakeChatServer = {
  server: Server;
  baseURL: string;
  requests: Array<{ url: string; authorization?: string }>;
};

type LocalChromeHandle = {
  process: ChildProcessWithoutNullStreams;
  cdpUrl: string;
  userDataDir: string;
};

async function startFakeChatCompletionsServer(): Promise<FakeChatServer> {
  const responses = [
    JSON.stringify({ title: "Example Domain" }),
    JSON.stringify({ completed: true, progress: "done" }),
  ];
  const requests: Array<{ url: string; authorization?: string }> = [];

  const server = createServer((req, res) => {
    requests.push({
      url: req.url ?? "",
      authorization: req.headers.authorization,
    });

    const content = responses.shift();
    if (!content) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "unexpected extra request" } }));
      return;
    }

    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: `chatcmpl-test-${requests.length}`,
          object: "chat.completion",
          created: 0,
          model: "glm-4-flash",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content,
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to determine fake chat server address");
  }

  return {
    server,
    baseURL: `http://127.0.0.1:${address.port}`,
    requests,
  };
}

async function stopFakeChatCompletionsServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function startLocalChromeWithCdp(): Promise<LocalChromeHandle> {
  const chromePath = process.env.CHROME_PATH;
  if (!chromePath) {
    throw new Error("CHROME_PATH must be set for the local CDP integration test");
  }

  const userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "stagehand-cdp-v3-"),
  );
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${userDataDir}`,
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const cdpUrl = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for Chrome DevTools endpoint"));
    }, 15_000);

    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;

      clearTimeout(timeout);
      chrome.stderr.off("data", onData);
      chrome.removeAllListeners("exit");
      resolve(match[1]);
    };

    chrome.stderr.on("data", onData);
    chrome.once("exit", (code, signal) => {
      clearTimeout(timeout);
      chrome.stderr.off("data", onData);
      reject(
        new Error(
          `Chrome exited before exposing a DevTools endpoint (code=${code}, signal=${signal})`,
        ),
      );
    });
  });

  return {
    process: chrome,
    cdpUrl,
    userDataDir,
  };
}

async function stopLocalChrome(handle: LocalChromeHandle): Promise<void> {
  if (handle.process.exitCode === null && !handle.process.killed) {
    handle.process.kill("SIGTERM");
    await once(handle.process, "exit").catch((): undefined => undefined);
  }
  await fs.rm(handle.userDataDir, { recursive: true, force: true });
}

// Shared session for all extract tests (extract is read-only, safe to share)
let sessionId: string;
let cdpUrl: string;

before(async () => {
  ({ sessionId, cdpUrl } = await createSessionWithCdp(getHeaders("3.0.0")));
  const navResponse = await navigateSession(
    sessionId,
    "https://example.com",
    getHeaders("3.0.0"),
  );
  assert.equal(navResponse.status, HTTP_OK, "Navigate should succeed");
});

after(async () => {
  await endSession(sessionId, getHeaders("3.0.0"));
});

// =============================================================================
// POST /v1/sessions/:id/extract - V3 Format Tests
// =============================================================================

describe("POST /v1/sessions/:id/extract (V3)", () => {
  it("should extract data with instruction and schema", async () => {
    const url = getBaseUrl();
    const frameId = await getMainFrameId(cdpUrl);

    interface ExtractResponse {
      success: boolean;
      data?: { result: Record<string, unknown>; actionId?: string };
    }

    const ctx = await fetchWithContext<ExtractResponse>(
      `${url}/v1/sessions/${sessionId}/extract`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          instruction: "extract the page title",
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
            },
            required: ["title"],
          },
          frameId,
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Extract should succeed");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result,
      "object",
      "Result should be an object",
    );
    assertFetchOk(
      "title" in ctx.body.data.result,
      "Result should have title property",
      ctx,
    );
  });

  it("should extract with instruction and options", async () => {
    const url = getBaseUrl();

    interface ExtractResponse {
      success: boolean;
      data?: { result: Record<string, unknown>; actionId?: string };
    }

    const ctx = await fetchWithContext<ExtractResponse>(
      `${url}/v1/sessions/${sessionId}/extract`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          instruction: "extract the page title",
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
            },
          },
          options: {
            timeout: 30000,
          },
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Extract with options should succeed");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result,
      "object",
      "Result should be an object",
    );
  });

  it("should extract with CSS selector in options", async () => {
    const url = getBaseUrl();

    interface ExtractResponse {
      success: boolean;
      data?: { result: Record<string, unknown>; actionId?: string };
    }

    const ctx = await fetchWithContext<ExtractResponse>(
      `${url}/v1/sessions/${sessionId}/extract`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          instruction: "extract the link information",
          schema: {
            type: "object",
            properties: {
              href: { type: "string" },
              text: { type: "string" },
            },
          },
          options: {
            selector: "a", // CSS selector
          },
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Extract with CSS selector should succeed");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result,
      "object",
      "Result should be an object",
    );
  });

  it("should extract with XPath selector in options", async () => {
    const url = getBaseUrl();

    interface ExtractResponse {
      success: boolean;
      data?: { result: Record<string, unknown>; actionId?: string };
    }

    const ctx = await fetchWithContext<ExtractResponse>(
      `${url}/v1/sessions/${sessionId}/extract`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          instruction: "extract the link information",
          schema: {
            type: "object",
            properties: {
              href: { type: "string" },
              text: { type: "string" },
            },
          },
          options: {
            selector: "//a", // XPath selector
          },
        }),
      },
    );

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "Extract with XPath selector should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result,
      "object",
      "Result should be an object",
    );
  });

  it("should extract with instruction only (no schema)", async () => {
    const url = getBaseUrl();

    interface ExtractResponse {
      success: boolean;
      data?: { result: Record<string, unknown>; actionId?: string };
    }

    const ctx = await fetchWithContext<ExtractResponse>(
      `${url}/v1/sessions/${sessionId}/extract`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          instruction: "extract the main content from the page",
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Extract without schema should succeed");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result,
      "object",
      "Result should be an object",
    );
  });

  it("should extract without instruction (extract all)", async () => {
    const url = getBaseUrl();

    interface ExtractResponse {
      success: boolean;
      data?: { result: Record<string, unknown>; actionId?: string };
    }

    const ctx = await fetchWithContext<ExtractResponse>(
      `${url}/v1/sessions/${sessionId}/extract`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          options: {
            timeout: 30000,
          },
        }),
      },
    );

    assertFetchStatus(
      ctx,
      HTTP_OK,
      "Extract without instruction should succeed",
    );
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result,
      "object",
      "Result should be an object",
    );
  });

  it("should extract with google/gemini-2.5-flash-lite model", async () => {
    const url = getBaseUrl();
    const geminiApiKey = requireEnv("GEMINI_API_KEY", GEMINI_API_KEY);

    interface ExtractResponse {
      success: boolean;
      data?: { result: Record<string, unknown>; actionId?: string };
    }

    const ctx = await fetchWithContext<ExtractResponse>(
      `${url}/v1/sessions/${sessionId}/extract`,
      {
        method: "POST",
        headers: getHeaders("3.0.0"),
        body: JSON.stringify({
          instruction: "extract the page title",
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
            },
            required: ["title"],
          },
          options: {
            model: {
              modelName: "google/gemini-2.5-flash-lite",
              apiKey: geminiApiKey,
            },
          },
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Extract with Gemini model should succeed");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(!!ctx.body.data, "Response should have data", ctx);
    assertFetchOk(!!ctx.body.data.result, "Response should have result", ctx);
    assert.equal(
      typeof ctx.body.data.result,
      "object",
      "Result should be an object",
    );
    assertFetchOk(
      "title" in ctx.body.data.result,
      "Result should have title property",
      ctx,
    );
  });

  it("should use x-model-base-url for chatcompletions extract requests", async () => {
    const url = getBaseUrl();
    const fakeChatServer = await startFakeChatCompletionsServer();
    const localChrome = await startLocalChromeWithCdp();
    let customSessionId: string | undefined;

    try {
      const headers = {
        ...getHeaders("3.0.0"),
        "x-model-api-key": "test-key",
        "x-model-base-url": fakeChatServer.baseURL,
      };

      interface StartResponse {
        success: boolean;
        data?: {
          sessionId: string;
          cdpUrl: string;
          available: boolean;
        };
      }

      const startCtx = await fetchWithContext<StartResponse>(
        `${url}/v1/sessions/start`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            modelName: "chatcompletions/glm-4-flash",
            browser: { type: "local", cdpUrl: localChrome.cdpUrl },
          }),
        },
      );

      assertFetchStatus(startCtx, HTTP_OK, "Session start should succeed");
      assertFetchOk(startCtx.body !== null, "Start should have body", startCtx);
      assertFetchOk(
        Boolean(startCtx.body.success && startCtx.body.data?.sessionId),
        "Start should return a sessionId",
        startCtx,
      );

      customSessionId = startCtx.body.data?.sessionId;
      assert.ok(customSessionId, "Expected a custom session id");

      const navResponse = await navigateSession(
        customSessionId,
        "https://example.com",
        headers,
      );
      assert.equal(navResponse.status, HTTP_OK, "Navigate should succeed");

      const frameId = await getMainFrameId(localChrome.cdpUrl);

      interface ExtractResponse {
        success: boolean;
        data?: { result: Record<string, unknown>; actionId?: string };
      }

      const extractCtx = await fetchWithContext<ExtractResponse>(
        `${url}/v1/sessions/${customSessionId}/extract`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            instruction: "extract the page title",
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
              },
              required: ["title"],
            },
            frameId,
          }),
        },
      );

      assertFetchStatus(
        extractCtx,
        HTTP_OK,
        "Extract through custom model base URL should succeed",
      );
      assertFetchOk(
        extractCtx.body !== null,
        "Extract should have response body",
        extractCtx,
      );
      assertFetchOk(
        extractCtx.body.success,
        "Extract should indicate success",
        extractCtx,
      );
      assert.equal(extractCtx.body.data?.result.title, "Example Domain");
      assert.equal(
        fakeChatServer.requests.length,
        2,
        "Expected extract + metadata requests to hit the fake server",
      );
      for (const request of fakeChatServer.requests) {
        assert.ok(
          request.url.endsWith("/chat/completions") ||
            request.url.endsWith("/v1/chat/completions"),
          `Unexpected request path: ${request.url}`,
        );
        assert.equal(request.authorization, "Bearer test-key");
      }
    } finally {
      if (customSessionId) {
        await endSession(customSessionId, {
          ...getHeaders("3.0.0"),
          "x-model-api-key": "test-key",
          "x-model-base-url": fakeChatServer.baseURL,
        }).catch((): undefined => undefined);
      }
      await stopLocalChrome(localChrome).catch((): undefined => undefined);
      await stopFakeChatCompletionsServer(fakeChatServer.server).catch(
        (): undefined => undefined,
      );
    }
  });
});

// =============================================================================
// SSE Streaming Tests - V3
// =============================================================================

describe("POST /v1/sessions/:id/extract with SSE streaming (V3)", () => {
  it("should stream valid SSE events with correct structure", async () => {
    const url = getBaseUrl();

    const response = await fetch(`${url}/v1/sessions/${sessionId}/extract`, {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body: JSON.stringify({
        instruction: "extract the page title",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
          required: ["title"],
        },
        streamResponse: true,
      }),
    });

    const ctx = await readTypedSSEStreamWithContext<ExtractResult>(response);
    const { events } = ctx;

    assertWithContext(
      events.length >= 2,
      "Should have at least starting and finished events",
      ctx,
    );

    // Verify starting event
    const startingEvent = assertEventExists(events, "starting", ctx);
    assert.equal(
      startingEvent.type,
      "system",
      "Starting event should be system type",
    );

    // Verify finished event with result
    const finishedEvent = assertEventExists(events, "finished", ctx);
    assert.equal(
      finishedEvent.type,
      "system",
      "Finished event should be system type",
    );
    assertWithContext(
      !!finishedEvent.data.result,
      "Finished event must have result",
      ctx,
    );
    assert.equal(
      typeof finishedEvent.data.result,
      "object",
      "Result must be an object",
    );
    assertWithContext(
      "title" in finishedEvent.data.result,
      "Result should have title property",
      ctx,
    );
  });

  it("should have correct event sequence: starting -> connected -> finished", async () => {
    const url = getBaseUrl();

    const response = await fetch(`${url}/v1/sessions/${sessionId}/extract`, {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body: JSON.stringify({
        instruction: "extract the page title",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
        },
        streamResponse: true,
      }),
    });

    const ctx = await readTypedSSEStreamWithContext<ExtractResult>(response);
    const { events } = ctx;

    assertEventExists(events, "starting", ctx);
    assertEventExists(events, "connected", ctx);
    assertEventExists(events, "finished", ctx);

    const startingIndex = events.findIndex((e) => e.data.status === "starting");
    const connectedIndex = events.findIndex(
      (e) => e.data.status === "connected",
    );
    const finishedIndex = events.findIndex((e) => e.data.status === "finished");

    assertWithContext(
      startingIndex < connectedIndex,
      "Starting event must come before connected event",
      ctx,
    );
    assertWithContext(
      connectedIndex < finishedIndex,
      "Connected event must come before finished event",
      ctx,
    );
  });

  it("should have valid UUID for each event id", async () => {
    const url = getBaseUrl();

    const response = await fetch(`${url}/v1/sessions/${sessionId}/extract`, {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body: JSON.stringify({
        instruction: "extract the page title",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
        },
        streamResponse: true,
      }),
    });

    const ctx = await readTypedSSEStreamWithContext<ExtractResult>(response);
    const { events } = ctx;

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const event of events) {
      assertWithContext(
        uuidRegex.test(event.id),
        `Event id should be a valid UUID format, got: ${event.id}`,
        ctx,
      );
    }
  });

  it("should extract data matching the provided schema", async () => {
    const url = getBaseUrl();

    const response = await fetch(`${url}/v1/sessions/${sessionId}/extract`, {
      method: "POST",
      headers: getHeaders("3.0.0"),
      body: JSON.stringify({
        instruction: "extract the page title",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
          required: ["title"],
        },
        streamResponse: true,
      }),
    });

    const ctx = await readTypedSSEStreamWithContext<ExtractResult>(response);
    const { events } = ctx;

    const finishedEvent = assertEventExists(events, "finished", ctx);
    assertWithContext(!!finishedEvent.data.result, "Should have result", ctx);

    // Verify the extracted data has the expected shape
    assert.equal(
      typeof finishedEvent.data.result.title,
      "string",
      "Extracted title should be a string",
    );
  });
});
