import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { StagehandAPIClient } from "../../lib/v3/api";

/**
 * Tests that modelApiKey is optional when calling StagehandAPIClient.init().
 *
 * Previously, init() would throw "modelApiKey is required" if the key was not
 * provided. After the fix, sessions can be started without a model API key
 * (the server may provide its own key or the user may not need one).
 * When provided, the key should still be sent via the x-model-api-key header.
 */
describe("StagehandAPIClient - optional modelApiKey", () => {
  const logger = vi.fn();

  // We mock fetch to avoid real network calls; we just need to verify
  // that init() doesn't throw when modelApiKey is omitted and that
  // the header is conditionally included.
  let originalFetch: typeof globalThis.fetch;

  function createSessionStartResponse(sessionId: string) {
    return new Response(
      JSON.stringify({
        success: true,
        data: { sessionId, available: true },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    logger.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.STAGEHAND_BASE_URL;
    delete process.env.STAGEHAND_API_URL;
    vi.restoreAllMocks();
  });

  it("should NOT throw when modelApiKey is omitted", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(createSessionStartResponse("sess-123"));

    const client = new StagehandAPIClient({
      apiKey: "test-api-key",
      logger,
    });

    // Should not throw "modelApiKey is required"
    await expect(
      client.init({
        modelName: "openai/gpt-4.1-mini",
      }),
    ).resolves.toBeDefined();
  });

  it("should NOT throw when modelApiKey is undefined", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(createSessionStartResponse("sess-456"));

    const client = new StagehandAPIClient({
      apiKey: "test-api-key",
      logger,
    });

    await expect(
      client.init({
        modelName: "openai/gpt-4.1-mini",
        modelApiKey: undefined,
      }),
    ).resolves.toBeDefined();
  });

  it("should send x-model-api-key header when modelApiKey IS provided", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(createSessionStartResponse("sess-789"));
    globalThis.fetch = fetchSpy;

    const client = new StagehandAPIClient({
      apiKey: "test-api-key",
      logger,
    });

    await client.init({
      modelName: "openai/gpt-4.1-mini",
      modelApiKey: "my-model-key",
    });

    // Verify the fetch was called with x-model-api-key header
    const [, requestInit] = fetchSpy.mock.calls[0];
    expect(requestInit.headers["x-model-api-key"]).toBe("my-model-key");
  });

  it("should NOT send x-model-api-key header when modelApiKey is omitted", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(createSessionStartResponse("sess-012"));
    globalThis.fetch = fetchSpy;

    const client = new StagehandAPIClient({
      apiKey: "test-api-key",
      logger,
    });

    await client.init({
      modelName: "openai/gpt-4.1-mini",
    });

    // Verify x-model-api-key header is NOT present
    const [, requestInit] = fetchSpy.mock.calls[0];
    expect(requestInit.headers["x-model-api-key"]).toBeUndefined();
  });

  it("should use STAGEHAND_API_URL for the API base URL", async () => {
    process.env.STAGEHAND_API_URL = "http://localhost:5000";
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(createSessionStartResponse("sess-api-url"));
    globalThis.fetch = fetchSpy;

    const client = new StagehandAPIClient({
      apiKey: "test-api-key",
      logger,
    });

    await client.init({
      modelName: "openai/gpt-4.1-mini",
    });

    const [url] = fetchSpy.mock.calls[0];
    expect(url.toString()).toBe("http://localhost:5000/v1/sessions/start");
  });

  it("should use STAGEHAND_BASE_URL as a legacy fallback", async () => {
    process.env.STAGEHAND_BASE_URL = "http://localhost:5001";
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(createSessionStartResponse("sess-base-url"));
    globalThis.fetch = fetchSpy;

    const client = new StagehandAPIClient({
      apiKey: "test-api-key",
      logger,
    });

    await client.init({
      modelName: "openai/gpt-4.1-mini",
    });

    const [url] = fetchSpy.mock.calls[0];
    expect(url.toString()).toBe("http://localhost:5001/v1/sessions/start");
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "config",
        message:
          "STAGEHAND_BASE_URL is deprecated. Use STAGEHAND_API_URL instead.",
        level: 0,
      }),
    );
  });

  it("should prefer STAGEHAND_API_URL over STAGEHAND_BASE_URL", async () => {
    process.env.STAGEHAND_BASE_URL = "http://localhost:5002";
    process.env.STAGEHAND_API_URL = "http://localhost:5003";
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(createSessionStartResponse("sess-base-precedence"));
    globalThis.fetch = fetchSpy;

    const client = new StagehandAPIClient({
      apiKey: "test-api-key",
      logger,
    });

    await client.init({
      modelName: "openai/gpt-4.1-mini",
    });

    const [url] = fetchSpy.mock.calls[0];
    expect(url.toString()).toBe("http://localhost:5003/v1/sessions/start");
    expect(logger).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "STAGEHAND_BASE_URL is deprecated. Use STAGEHAND_API_URL instead.",
      }),
    );
  });
});
