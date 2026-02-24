import { afterEach, describe, expect, it, vi } from "vitest";
import { StagehandAPIClient } from "../../../core/lib/v3/api.js";
import type { Action } from "../../../core/lib/v3/types/public/methods.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal SSE "finished" event body that the execute() loop accepts. */
function sseResponse(
  result: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  const event = JSON.stringify({
    type: "system",
    data: { status: "finished", result },
  });
  const encoded = new TextEncoder().encode(`data: ${event}\n\n`);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    }),
    { status: 200, headers: extraHeaders },
  );
}

/** Minimal successful /sessions/start response. */
function initResponse(sessionId = "session-test"): Response {
  return new Response(
    JSON.stringify({ success: true, data: { sessionId, available: true } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const ACT_RESULT = {
  success: true,
  message: "done",
  actionDescription: "clicked",
  actions: [] as Action[],
};

const EXTRACT_RESULT = { extraction: "some text" };
const OBSERVE_RESULT: unknown[] = [];

/** Create a client with fetch mocked, and run init() so sessionId/modelApiKey are set. */
async function buildClient(serverCache?: boolean) {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    initResponse(),
  );

  const client = new StagehandAPIClient({
    apiKey: "test-key",
    projectId: "test-project",
    logger: vi.fn(),
    serverCache,
  });

  await client.init({ modelName: "openai/gpt-4o", modelApiKey: "test-model-key" });

  // fetchSpy.mock.calls[0] is the /sessions/start request — clear it so that
  // subsequent assertions can use index 0 for the method under test.
  fetchSpy.mockClear();

  return { client, fetchSpy };
}

/** Extract the headers sent on a captured fetch call. */
function headersOf(spy: ReturnType<typeof vi.spyOn>, callIndex = 0) {
  const options = spy.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  return (options?.headers ?? {}) as Record<string, string>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StagehandAPIClient – serverCache flag", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // browserbase-cache-bypass header
  // -------------------------------------------------------------------------

  describe("browserbase-cache-bypass request header", () => {
    it("is sent when instance serverCache is false", async () => {
      const { client, fetchSpy } = await buildClient(false);
      fetchSpy.mockResolvedValueOnce(sseResponse(ACT_RESULT));

      await client.act({ input: "click the button" });

      expect(headersOf(fetchSpy)["browserbase-cache-bypass"]).toBe("true");
    });

    it("is NOT sent when instance serverCache is true", async () => {
      const { client, fetchSpy } = await buildClient(true);
      fetchSpy.mockResolvedValueOnce(sseResponse(ACT_RESULT));

      await client.act({ input: "click the button" });

      expect(headersOf(fetchSpy)["browserbase-cache-bypass"]).toBeUndefined();
    });

    it("is NOT sent when serverCache defaults (true)", async () => {
      const { client, fetchSpy } = await buildClient(/* default */);
      fetchSpy.mockResolvedValueOnce(sseResponse(ACT_RESULT));

      await client.act({ input: "click the button" });

      expect(headersOf(fetchSpy)["browserbase-cache-bypass"]).toBeUndefined();
    });

    it("method-level false overrides instance true", async () => {
      const { client, fetchSpy } = await buildClient(true);
      fetchSpy.mockResolvedValueOnce(sseResponse(ACT_RESULT));

      await client.act({
        input: "click the button",
        options: { serverCache: false },
      });

      expect(headersOf(fetchSpy)["browserbase-cache-bypass"]).toBe("true");
    });

    it("method-level true overrides instance false", async () => {
      const { client, fetchSpy } = await buildClient(false);
      fetchSpy.mockResolvedValueOnce(sseResponse(ACT_RESULT));

      await client.act({
        input: "click the button",
        options: { serverCache: true },
      });

      expect(headersOf(fetchSpy)["browserbase-cache-bypass"]).toBeUndefined();
    });

    it("applies to extract", async () => {
      const { client, fetchSpy } = await buildClient(false);
      fetchSpy.mockResolvedValueOnce(sseResponse(EXTRACT_RESULT));

      await client.extract({ instruction: "get the title" });

      expect(headersOf(fetchSpy)["browserbase-cache-bypass"]).toBe("true");
    });

    it("applies to observe", async () => {
      const { client, fetchSpy } = await buildClient(false);
      fetchSpy.mockResolvedValueOnce(sseResponse(OBSERVE_RESULT));

      await client.observe({ instruction: "find all buttons" });

      expect(headersOf(fetchSpy)["browserbase-cache-bypass"]).toBe("true");
    });
  });

  // -------------------------------------------------------------------------
  // cacheStatus on results
  // -------------------------------------------------------------------------

  describe("cacheStatus from browserbase-cache-status response header", () => {
    it("attaches HIT to ActResult", async () => {
      const { client, fetchSpy } = await buildClient(true);
      fetchSpy.mockResolvedValueOnce(
        sseResponse(ACT_RESULT, { "browserbase-cache-status": "HIT" }),
      );

      const result = await client.act({ input: "click the button" });

      expect(result.cacheStatus).toBe("HIT");
    });

    it("attaches MISS to ActResult", async () => {
      const { client, fetchSpy } = await buildClient(true);
      fetchSpy.mockResolvedValueOnce(
        sseResponse(ACT_RESULT, { "browserbase-cache-status": "MISS" }),
      );

      const result = await client.act({ input: "click the button" });

      expect(result.cacheStatus).toBe("MISS");
    });

    it("leaves cacheStatus undefined when header is absent", async () => {
      const { client, fetchSpy } = await buildClient(true);
      fetchSpy.mockResolvedValueOnce(sseResponse(ACT_RESULT));

      const result = await client.act({ input: "click the button" });

      expect(result.cacheStatus).toBeUndefined();
    });

    it("attaches HIT to ExtractResult", async () => {
      const { client, fetchSpy } = await buildClient(true);
      fetchSpy.mockResolvedValueOnce(
        sseResponse(EXTRACT_RESULT, { "browserbase-cache-status": "HIT" }),
      );

      const result = await client.extract({ instruction: "get the title" });

      expect(result.cacheStatus).toBe("HIT");
    });

    it("attaches HIT to ObserveResult", async () => {
      const { client, fetchSpy } = await buildClient(true);
      fetchSpy.mockResolvedValueOnce(
        sseResponse(OBSERVE_RESULT, { "browserbase-cache-status": "HIT" }),
      );

      const result = await client.observe({ instruction: "find all buttons" });

      expect(result.cacheStatus).toBe("HIT");
    });
  });
});
