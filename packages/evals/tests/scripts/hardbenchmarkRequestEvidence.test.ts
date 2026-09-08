import { describe, expect, it, vi } from "vitest";
import {
  createLiveVerifierFetch,
  assertVerifierEndpoint,
  HardBenchmarkGateError,
  sanitizeGateError,
  type VerifierRequestEvidence,
} from "../../scripts/hardbenchmark-request-evidence.js";

const schema = { type: "object", properties: { per_criterion: { type: "array" } } };

describe("live verifier request evidence", () => {
  it("captures the Google body without auth or query secrets and forwards the original request", async () => {
    const captured: VerifierRequestEvidence[] = [];
    const secret = "synthetic-google-key";
    const payload = {
      contents: [{ parts: [{ text: `fixture text ${secret}` }] }],
      generationConfig: { responseSchema: schema },
      metadata: { api_key: "different-secret", authorization: "Bearer token" },
    };
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (request: Request) => {
      expect(request.headers.get("x-goog-api-key")).toBe(secret);
      expect(await request.clone().json()).toEqual(payload);
      expect(request.url).toContain(`key=${secret}`);
      controller.abort();
      expect(request.signal.aborted).toBe(true);
      return new Response("provider response");
    });
    const wrapped = createLiveVerifierFetch({
      provider: "google",
      fetchImpl,
      redactValues: [secret],
      onRequest: (entry) => {
        captured.push(entry);
      },
    });
    const response = await wrapped(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${secret}`,
      {
        method: "POST",
        headers: { "x-goog-api-key": secret },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );
    expect(await response.text()).toBe("provider response");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(captured[0]).toMatchObject({
      captureVersion: 1,
      schema: "FusedJudgment",
      method: "POST",
      endpoint:
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    });
    expect(captured[0].bodyHash).toMatch(/^[a-f0-9]{64}$/);
    const text = JSON.stringify(captured);
    for (const value of [secret, "different-secret", "Bearer token", "?key="])
      expect(text).not.toContain(value);
    expect(captured[0]).not.toHaveProperty("headers");
  });

  it.each([
    ["https://unrelated.example/v1/responses", { text: { format: { schema } } }],
    ["http://api.openai.com/v1/responses", { text: { format: { schema } } }],
    ["https://api.openai.com/v1/files", { text: { format: { schema } } }],
    [
      "https://api.openai.com/v1/responses",
      {
        text: {
          format: {
            schema: {
              properties: { items: { type: "array", items: { properties: { criterion: {} } } } },
            },
          },
        },
      },
    ],
  ])(
    "rejects unrelated endpoints and rubric generation before transport: %s",
    async (url, body) => {
      const fetchImpl = vi.fn();
      const onRequest = vi.fn();
      const wrapped = createLiveVerifierFetch({ provider: "openai", fetchImpl, onRequest });
      await expect(wrapped(url, { method: "POST", body: JSON.stringify(body) })).rejects.toThrow(
        /Unexpected (live )?verifier/,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(onRequest).not.toHaveBeenCalled();
    },
  );

  it("does not send a request when its evidence cannot be persisted", async () => {
    const fetchImpl = vi.fn();
    const wrapped = createLiveVerifierFetch({
      provider: "openai",
      fetchImpl,
      onRequest: async () => {
        throw new Error("evidence write failed");
      },
    });
    await expect(
      wrapped("https://api.openai.com/v1/responses", {
        method: "POST",
        body: JSON.stringify({ text: { format: { schema } } }),
      }),
    ).rejects.toThrow("evidence write failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["http://api.openai.com/v1/responses", "POST"],
    ["https://api.openai.com/v1/files", "POST"],
    ["https://api.openai.com/v1/responses", "GET"],
    ["https://api.openai.com/v1/chat/completions", "PUT"],
  ])("rejects unsupported transport in both live and offline gates: %s %s", (url, method) => {
    expect(() => assertVerifierEndpoint(new Request(url, { method }), "openai")).toThrow(
      HardBenchmarkGateError,
    );
  });

  it.each(["/v1/responses", "/v1/chat/completions"])(
    "accepts the supported HTTPS POST generation endpoint: %s",
    (endpoint) => {
      expect(() =>
        assertVerifierEndpoint(
          new Request(`https://api.openai.com${endpoint}`, { method: "POST" }),
          "openai",
        ),
      ).not.toThrow();
    },
  );

  it("sanitizes provider error text and an active credential before reporting", () => {
    const detail =
      "https://provider.example?apiKey=private-query Bearer private-token-value active-key";
    const sanitized = sanitizeGateError(new Error(detail), ["active-key"]);
    for (const secret of ["private-query", "private-token-value", "active-key"])
      expect(sanitized).not.toContain(secret);
    expect(new HardBenchmarkGateError(detail).message).not.toContain("private-query");
  });
});
