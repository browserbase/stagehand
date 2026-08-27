import type { ToolContext } from "eve/tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browserbaseWebFetch, browserbaseWebSearch } from "../src/tools/index.js";
import { browserbaseWebFetchInputSchema } from "../src/tools/web-fetch.js";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  fetch: vi.fn(),
  search: vi.fn(),
}));

vi.mock("@browserbasehq/sdk", () => ({
  default: class Browserbase {
    readonly fetchAPI = { create: mocks.fetch };
    readonly search = { web: mocks.search };

    constructor(options: unknown) {
      mocks.createClient(options);
    }
  },
}));

const abortSignal = new AbortController().signal;
const toolContext = { abortSignal } as ToolContext;

describe("Browserbase Eve web tools", () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.fetch.mockReset();
    mocks.search.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a reusable Browserbase web search tool", async () => {
    const response = { query: "stagehand", requestId: "request-one", results: [] };
    mocks.search.mockResolvedValueOnce(response);
    const tool = browserbaseWebSearch({
      apiKey: "test-key",
      baseUrl: "https://api.example.test///",
      maxRetries: 1,
      timeoutMs: 5_000,
    });

    await expect(tool.execute({ query: "stagehand", numResults: 5 }, toolContext)).resolves.toBe(
      response,
    );
    expect(mocks.createClient).toHaveBeenCalledWith({
      apiKey: "test-key",
      baseURL: "https://api.example.test",
      maxRetries: 1,
      timeout: 5_000,
    });
    expect(mocks.search).toHaveBeenCalledWith(
      { query: "stagehand", numResults: 5 },
      { signal: abortSignal },
    );
  });

  it("creates a reusable Browserbase web fetch tool", async () => {
    const response = {
      id: "fetch-one",
      content: "# Example",
      contentType: "text/markdown",
      encoding: "utf-8",
      headers: {},
      statusCode: 200,
    };
    mocks.fetch.mockResolvedValueOnce(response);
    const tool = browserbaseWebFetch({ apiKey: "test-key" });

    await expect(
      tool.execute(
        {
          url: "https://example.com",
          format: "markdown",
          schema: undefined,
          allowRedirects: true,
          allowInsecureSsl: false,
          proxies: false,
        },
        toolContext,
      ),
    ).resolves.toBe(response);
    expect(mocks.fetch).toHaveBeenCalledWith(
      {
        url: "https://example.com",
        format: "markdown",
        schema: undefined,
        allowRedirects: true,
        allowInsecureSsl: false,
        proxies: false,
      },
      { signal: abortSignal },
    );
  });

  it("resolves the default API key lazily from the runtime environment", async () => {
    const response = { query: "stagehand", requestId: "request-two", results: [] };
    mocks.search.mockResolvedValueOnce(response);
    const tool = browserbaseWebSearch();

    expect(mocks.createClient).not.toHaveBeenCalled();
    vi.stubEnv("BROWSERBASE_API_KEY", "runtime-key");

    await expect(tool.execute({ query: "stagehand", numResults: 10 }, toolContext)).resolves.toBe(
      response,
    );
    expect(mocks.createClient).toHaveBeenCalledWith({ apiKey: "runtime-key" });
  });

  it("validates structured fetch inputs and applies safe defaults", async () => {
    const missingSchema = await browserbaseWebFetchInputSchema["~standard"].validate({
      url: "https://example.com",
      format: "json",
    });
    const misplacedSchema = await browserbaseWebFetchInputSchema["~standard"].validate({
      url: "https://example.com",
      format: "markdown",
      schema: { type: "object" },
    });
    const missingTopLevelType = await browserbaseWebFetchInputSchema["~standard"].validate({
      url: "https://example.com",
      format: "json",
      schema: { properties: { title: { type: "string" } } },
    });
    const structured = await browserbaseWebFetchInputSchema["~standard"].validate({
      url: "https://example.com",
      format: "json",
      schema: { type: "object", properties: { title: { type: "string" } } },
    });
    const valid = await browserbaseWebFetchInputSchema["~standard"].validate({
      url: "https://example.com",
    });

    expect("issues" in missingSchema).toBe(true);
    expect("issues" in misplacedSchema).toBe(true);
    expect(missingTopLevelType).toMatchObject({
      issues: [{ message: "schema.type must declare a top-level JSON Schema type." }],
    });
    expect("issues" in structured).toBe(false);
    expect(valid).toMatchObject({
      value: {
        url: "https://example.com",
        format: "markdown",
        allowRedirects: true,
        allowInsecureSsl: false,
        proxies: false,
      },
    });
  });

  it("rejects invalid client options on first execution", () => {
    const search = browserbaseWebSearch({ apiKey: "" });
    const retries = browserbaseWebFetch({ apiKey: "test-key", maxRetries: -1 });
    const timeout = browserbaseWebFetch({ apiKey: "test-key", timeoutMs: 0 });

    expect(() => search.execute({ query: "stagehand", numResults: 10 }, toolContext)).toThrow(
      "Browserbase web tools require apiKey or the BROWSERBASE_API_KEY environment variable.",
    );
    expect(() =>
      retries.execute(
        {
          url: "https://example.com",
          format: "markdown",
          schema: undefined,
          allowRedirects: true,
          allowInsecureSsl: false,
          proxies: false,
        },
        toolContext,
      ),
    ).toThrow("Browserbase web tool maxRetries must be a non-negative integer.");
    expect(() =>
      timeout.execute(
        {
          url: "https://example.com",
          format: "markdown",
          schema: undefined,
          allowRedirects: true,
          allowInsecureSsl: false,
          proxies: false,
        },
        toolContext,
      ),
    ).toThrow("Browserbase web tool timeoutMs must be a positive number.");
  });
});
