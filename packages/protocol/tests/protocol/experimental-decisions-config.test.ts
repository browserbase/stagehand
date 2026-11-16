import { describe, expect, it } from "vitest";
import { ExperimentalDecisionsConfigSchema } from "../../schemas.js";

describe("experimental decision configuration", () => {
  it.each([
    { apiKey: "key" },
    { provider: "typesafe", apiKey: "key" },
    { provider: "cloudflare", apiKey: "key", accountId: "account-1" },
    {
      provider: "cloudflare",
      apiKey: "key",
      apiUrl: "https://gateway.example/accounts/account-1/ai/run",
    },
  ])("accepts supported connection settings: %j", (config) => {
    expect(ExperimentalDecisionsConfigSchema.parse(config)).toStrictEqual(config);
  });

  it("requires Cloudflare account metadata", () => {
    expect(() =>
      ExperimentalDecisionsConfigSchema.parse({ provider: "cloudflare", apiKey: "key" }),
    ).toThrow("Cloudflare decisions require accountId or an account-scoped apiUrl");
  });

  it.each([
    "http://example.com",
    "https:///",
    "https://[bad",
    "https://host:bad",
    "https://example.com?",
    "https://example.com#",
    "https://example.com/path?query=value",
    "https://example.com\\path",
    "https://example.com/with space",
  ])("rejects invalid decision endpoints: %s", (apiUrl) => {
    expect(ExperimentalDecisionsConfigSchema.safeParse({ apiKey: "key", apiUrl }).success).toBe(
      false,
    );
  });

  it.each(["act", "extract", "verify", "llmFallback", "actConfidence", "retryNoEffect"])(
    "rejects retired policy option %s",
    (option) => {
      expect(
        ExperimentalDecisionsConfigSchema.safeParse({ apiKey: "key", [option]: true }).success,
      ).toBe(false);
    },
  );
});
