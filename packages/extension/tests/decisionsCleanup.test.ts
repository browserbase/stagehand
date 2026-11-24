import { afterEach, describe, expect, it, vi } from "vitest";
import { ExperimentalDecisionsConfigSchema } from "@browserbasehq/stagehand-protocol/schemas";
import { decide, locateAnswer } from "../services/decisions/client.js";
import { scalarReader } from "../services/decisions/scalarReader.js";
import { runWithProgress } from "../understudy/progress.js";

afterEach(() => vi.unstubAllGlobals());

describe("experimental decisions connection contract", () => {
  it.each([
    "act",
    "extract",
    "actConfidence",
    "verify",
    "llmFallback",
    "argumentLlm",
    "retryNoEffect",
    "focusFallback",
    "pageState",
    "cacheCheck",
    "tools",
    "targetReadiness",
    "enabled",
  ])("rejects the retired %s option", (option) => {
    expect(() =>
      ExperimentalDecisionsConfigSchema.parse({ apiKey: "test", [option]: true }),
    ).toThrow();
  });

  it("requires Cloudflare connection metadata before any request", () => {
    expect(() =>
      ExperimentalDecisionsConfigSchema.parse({ provider: "cloudflare", apiKey: "test" }),
    ).toThrow("accountId");
    expect(
      ExperimentalDecisionsConfigSchema.parse({
        provider: "cloudflare",
        apiKey: "test",
        apiUrl: "https://gateway.example/accounts/account/ai/run",
      }),
    ).toBeDefined();
  });

  it("defaults to pinned Decider and attributes actual model usage", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        model: "pplx-decider-v1.3",
        answers: {
          selected: {
            type: "choice",
            choice: "none",
            probabilities: { none: 1, target: 0 },
            confidence: 1,
          },
        },
        usage: { input_tokens: 20, output_tokens: 1 },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const record = vi.fn();
    await decide(
      { apiKey: "default-model-test", recordDecisionUsage: record },
      {},
      {
        selected: {
          type: "choice",
          instructions: "Find the target",
          criteria: { target: "Target", none: "Absent" },
        },
      },
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://api.perplexity.ai/v1/decisions",
      expect.objectContaining({ body: expect.stringContaining('"model":"pplx-decider-v1.3"') }),
    );
    expect(record).toHaveBeenCalledExactlyOnceWith({
      inputTokens: 20,
      outputTokens: 1,
      provider: "perplexity",
      model: "pplx-decider-v1.3",
    });
  });
});

describe("shared exact-span transport", () => {
  const state = "🙂 Price: $10; no warranty stated.";
  const start = Array.from("🙂 Price: ").length;
  const span = { start, end: start + 3, text: "$10", score: 0.98 };
  const question = { price: { type: "locate" as const, instructions: "Find the price" } };

  it("checks Unicode offsets and preserves empty-span abstention", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          answers: {
            price: { type: "locate", spans: [span] },
            warranty: { type: "locate", spans: [] },
          },
          usage: { input_tokens: 30, output_tokens: 2 },
        }),
      ),
    );
    const response = await decide({ apiKey: "unicode-locate" }, state, {
      ...question,
      warranty: { type: "locate", instructions: "Find the warranty" },
    });
    expect(locateAnswer(response, "price").spans).toEqual([span]);
    expect(locateAnswer(response, "warranty").spans).toEqual([]);
  });

  it.each([
    { ...span, start: start + 1 },
    { ...span, text: "$99" },
    { ...span, end: 999 },
    { ...span, score: 2 },
  ])("rejects an invalid span and keeps its billed usage: %j", async (invalid) => {
    const record = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          answers: { price: { type: "locate", spans: [invalid] } },
          usage: { input_tokens: 30, output_tokens: 2 },
        }),
      ),
    );
    await expect(
      decide({ apiKey: JSON.stringify(invalid), recordDecisionUsage: record }, state, question),
    ).rejects.toThrow("span does not match evidence");
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 30 }));
  });

  it.each(["typesafe", "cloudflare"] as const)(
    "does not call an unsupported reader on %s",
    async (provider) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await runWithProgress({ name: "reader-test", timeout: 0 }, async (progress) => {
        const config = { provider, apiKey: "unsupported-reader", accountId: "account" };
        expect(scalarReader(config, progress)).toBeUndefined();
        await expect(decide(config, state, question)).rejects.toThrow(
          "does not support exact-span reading",
        );
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
