import { describe, expect, it } from "vitest";
import { BrowserSessionMetadataSchema } from "@browserbasehq/stagehand-protocol/schemas";
import fixtures from "../../../tests/fixtures/browserbase-transport.json" with { type: "json" };
import { resolveBrowserbaseConnection } from "../src/browserbaseConnection.js";
import { StagehandClientCreateConfigSchema } from "../src/clientSchemas.js";
import type { StagehandWorkerInitMetadata } from "../src/browser/factories.js";

const { apiKey, sessionId } = fixtures.connection;

describe("client Browserbase connection settings", () => {
  it.each([
    ["http://localhost:3000", true],
    ["https://example.com", true],
    ["ftp://example.com", false],
    ["file:///tmp/api", false],
    ["ws://example.com", false],
  ])("validates the API URL scheme in %s", (apiUrl, accepted) => {
    expect(StagehandClientCreateConfigSchema.safeParse({ apiUrl }).success).toBe(accepted);
  });

  it.each([
    "https://example.com?",
    "https://example.com?tenant=test",
    "https://example.com#",
    "https://example.com#gateway",
    "https://example.com/v1/",
    "https://example.com/services/v1///",
  ])("rejects unsupported public API URL %s", (apiUrl) => {
    expect(StagehandClientCreateConfigSchema.safeParse({ apiKey, apiUrl }).success).toBe(false);
  });

  it.each(fixtures.endpoints)("resolves the $name endpoint", (fixture) => {
    const config = StagehandClientCreateConfigSchema.parse({
      apiKey,
      ...("apiUrl" in fixture ? { apiUrl: fixture.apiUrl } : {}),
    });
    const browser = BrowserSessionMetadataSchema.parse({
      sessionId,
      ...("region" in fixture ? { region: fixture.region } : {}),
    });

    expect(resolveBrowserbaseConnection(config, { browser })).toEqual({
      apiKey,
      apiUrl: fixture.expected,
      sessionId,
    });
  });

  it("uses the claimed-browser key before the Stagehand key", () => {
    const config = { apiKey: "bb-stagehand-key", apiUrl: "https://fixture.example/services/" };
    const metadata: StagehandWorkerInitMetadata = {
      apiKey,
      browser: { sessionId, region: "eu-central-1" },
    };

    expect(resolveBrowserbaseConnection(config, metadata)).toEqual({
      apiKey,
      apiUrl: "https://fixture.example/services/v1",
      sessionId,
    });
    expect(config.apiKey).toBe("bb-stagehand-key");
    expect(metadata).toEqual({ apiKey, browser: { sessionId, region: "eu-central-1" } });
  });

  it("works when only claimed-browser metadata supplies the key", () => {
    expect(resolveBrowserbaseConnection({}, { apiKey, browser: { sessionId } })).toEqual({
      apiKey,
      apiUrl: fixtures.endpoints[0].expected,
      sessionId,
    });
  });

  it.each([
    { name: "no connection settings", config: {}, metadata: {} },
    { name: "key without a session", config: { apiKey }, metadata: {} },
    { name: "session without a key", config: {}, metadata: { browser: { sessionId } } },
    { name: "claimed key without a session", config: {}, metadata: { apiKey } },
    {
      name: "explicitly unset claimed key",
      config: { apiKey },
      metadata: { apiKey: undefined, browser: { sessionId } },
    },
  ])("is unavailable with $name", ({ config, metadata }) => {
    expect(resolveBrowserbaseConnection(config, metadata)).toBeUndefined();
  });

  it("does not use a provider model key as the Browserbase key", () => {
    const config = StagehandClientCreateConfigSchema.parse({
      model: { modelName: "openai/gpt-5", apiKey: "provider-key" },
    });
    expect(resolveBrowserbaseConnection(config, { browser: { sessionId } })).toBeUndefined();
  });

  it.each([
    { modelName: "openai/gpt-5", apiKey: "provider-key" },
    { generate: async () => fixtures.gateway.result },
  ])("resolves the same connection with model %j and caching disabled", (model) => {
    const config = StagehandClientCreateConfigSchema.parse({ apiKey, cache: false, model });
    expect(resolveBrowserbaseConnection(config, { browser: { sessionId } })).toEqual({
      apiKey,
      apiUrl: fixtures.endpoints[0].expected,
      sessionId,
    });
  });

  it("takes an immutable snapshot without sharing state between connections", () => {
    const config = { apiKey, apiUrl: "https://first.example" };
    const metadata = { browser: { sessionId } };
    const first = resolveBrowserbaseConnection(config, metadata);

    config.apiKey = "bb-second-key";
    config.apiUrl = "https://second.example";
    metadata.browser.sessionId = "second-session";
    const second = resolveBrowserbaseConnection(config, metadata);

    expect(first).toEqual({ apiKey, apiUrl: "https://first.example/v1", sessionId });
    expect(second).toEqual({
      apiKey: "bb-second-key",
      apiUrl: "https://second.example/v1",
      sessionId: "second-session",
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
  });
});
