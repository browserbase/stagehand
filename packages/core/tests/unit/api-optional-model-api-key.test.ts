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
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
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
});
