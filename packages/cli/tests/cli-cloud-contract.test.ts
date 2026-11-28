import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getExtensionArchive } from "@browserbasehq/stagehand";
import { afterEach, describe, expect, it } from "vitest";

import {
  binaryResponse,
  jsonResponse,
  startFakeBrowserbaseServer,
  textResponse,
  type CapturedRequest,
} from "./helpers/fake-browserbase-server.js";
import { runCli } from "./helpers/run-cli.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (!path) {
      continue;
    }
    await rm(path, { recursive: true, force: true });
  }
});

describe("cloud API contracts", () => {
  it("fetch sends the expected POST body and prints JSON", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeFetchResponse("ok"));
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "fetch",
          "http://example.com",
          "--allow-redirects",
          "--allow-insecure-ssl",
          "--proxies",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout) as { content: string };
        expect(output.content).toBe("ok");
        expect(requests).toHaveLength(1);
        expectRequest(requests[0], "POST", "/v1/fetch", "test-key");
        expect(requests[0]?.jsonBody).toMatchObject({
          url: "http://example.com",
          allowRedirects: true,
          allowInsecureSsl: true,
          format: "markdown",
          proxies: true,
        });
      },
    );
  });

  it("fetch can request raw output", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeFetchResponse("<html>ok</html>"));
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "fetch",
          "http://example.com",
          "--format",
          "raw",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expectRequest(requests[0], "POST", "/v1/fetch", "test-key");
        expect(requests[0]?.jsonBody).toMatchObject({
          url: "http://example.com",
          format: "raw",
        });
      },
    );
  });

  it("fetch can request markdown output explicitly", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeFetchResponse("# Example"));
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "fetch",
          "http://example.com",
          "--format",
          "markdown",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout) as { content: string };
        expect(output.content).toBe("# Example");
        expectRequest(requests[0], "POST", "/v1/fetch", "test-key");
        expect(requests[0]?.jsonBody).toMatchObject({
          url: "http://example.com",
          format: "markdown",
        });
      },
    );
  });

  it("fetch sends schemas for JSON output", async () => {
    const schema = {
      type: "object",
      properties: {
        title: { type: "string" },
      },
      required: ["title"],
    };

    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeFetchResponse({ title: "Example" }, "application/json"));
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "fetch",
          "http://example.com",
          "--format",
          "json",
          "--schema",
          JSON.stringify(schema),
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout) as {
          content: { title: string };
        };
        expect(output.content.title).toBe("Example");
        expectRequest(requests[0], "POST", "/v1/fetch", "test-key");
        expect(requests[0]?.jsonBody).toMatchObject({
          url: "http://example.com",
          format: "json",
          schema,
        });
      },
    );
  });

  it("fetch writes content to an output file", async () => {
    const outputDir = await createTempDir("browse-fetch-output-");
    const outputPath = join(outputDir, "page.html");

    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeFetchResponse("<html>hello</html>", "text/html"));
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "fetch",
          "http://example.com",
          "--output",
          outputPath,
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          ok: true,
          outputPath,
          contentType: "text/html",
          statusCode: 200,
        });
        expect(await readFile(outputPath, "utf8")).toBe("<html>hello</html>");
      },
    );
  });

  it("fetch writes JSON content objects to an output file", async () => {
    const outputDir = await createTempDir("browse-fetch-output-");
    const outputPath = join(outputDir, "page.json");
    const schema = {
      type: "object",
      properties: {
        title: { type: "string" },
      },
      required: ["title"],
    };

    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeFetchResponse({ title: "Example" }, "application/json"));
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "fetch",
          "http://example.com",
          "--format",
          "json",
          "--schema",
          JSON.stringify(schema),
          "--output",
          outputPath,
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          ok: true,
          outputPath,
          contentType: "application/json",
          statusCode: 200,
        });
        expect(await readFile(outputPath, "utf8")).toBe(
          JSON.stringify({ title: "Example" }, null, 2),
        );
      },
    );
  });

  it("fetch rejects JSON output without a schema before calling the API", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeFetchResponse("unexpected"));
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "fetch",
          "http://example.com",
          "--format",
          "json",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("--schema is required when --format json.");
        expect(requests).toHaveLength(0);
      },
    );
  });

  it("fetch rejects schemas for non-JSON output before calling the API", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeFetchResponse("unexpected"));
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "fetch",
          "http://example.com",
          "--format",
          "markdown",
          "--schema",
          '{"type":"object"}',
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("--schema can only be used with --format json.");
        expect(requests).toHaveLength(0);
      },
    );
  });

  it("fetch rejects invalid schema JSON before calling the API", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeFetchResponse("unexpected"));
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "fetch",
          "http://example.com",
          "--format",
          "json",
          "--schema",
          "{",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Invalid JSON for schema");
        expect(requests).toHaveLength(0);
      },
    );
  });

  it("fetch prints API error messages", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 500, { message: "Internal upstream failure" });
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "fetch",
          "http://example.com",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Internal upstream failure");
      },
    );
  });

  it("fetch prints plain text API error messages", async () => {
    await withServer(
      async (_request, response) => {
        textResponse(response, 502, "Plain upstream failure");
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "fetch",
          "http://example.com",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Plain upstream failure");
      },
    );
  });

  it.each([
    { name: "server defaults", args: [], options: {} },
    {
      name: "Parallel fast mode",
      args: ["--provider", "parallel", "--mode", "fast"],
      options: { provider: "parallel", mode: "fast" },
    },
    {
      name: "Parallel advanced mode",
      args: ["--provider", "parallel", "--mode", "advanced"],
      options: { provider: "parallel", mode: "advanced" },
    },
    {
      name: "Parallel with the server's default mode",
      args: ["--provider", "parallel"],
      options: { provider: "parallel" },
    },
    {
      name: "Exa",
      args: ["--provider", "exa"],
      options: { provider: "exa" },
    },
    {
      name: "fast mode with explicit parallel provider",
      args: ["--provider", "parallel", "--mode", "fast"],
      options: { provider: "parallel", mode: "fast" },
    },
    {
      name: "advanced mode with explicit parallel provider",
      args: ["--provider", "parallel", "--mode", "advanced"],
      options: { provider: "parallel", mode: "advanced" },
    },
  ])("search sends the expected POST body and prints JSON: $name", async ({ args, options }) => {
    await withServer(
      async (_request, response) => {
        jsonResponse(
          response,
          200,
          makeSearchResponse("test query", [
            { id: "res_1", url: "https://example.com", title: "Example" },
          ]),
        );
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test query",
          ...args,
          "--num-results",
          "5",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout) as {
          query: string;
          results: unknown[];
        };
        expect(output.query).toBe("test query");
        expect(output.results).toHaveLength(1);
        expect(requests).toHaveLength(1);
        expectRequest(requests[0], "POST", "/v1/search", "test-key");
        expect(requests[0]?.jsonBody).toEqual({
          query: "test query",
          numResults: 5,
          ...options,
        });
      },
    );
  });

  it.each([
    { flag: "--provider", value: "unknown-provider" },
    { flag: "--mode", value: "unknown-mode" },
  ])("search rejects invalid $flag before calling the API", async ({ flag, value }) => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeSearchResponse("test query", []));
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test query",
          flag,
          value,
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain(flag);
        expect(result.stderr).toContain(value);
        expect(requests).toHaveLength(0);
      },
    );
  });

  it("search surfaces API errors for unsupported provider and mode combinations", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 400, {
          message: "mode is only supported by the parallel provider",
        });
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test query",
          "--provider",
          "exa",
          "--mode",
          "fast",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("mode is only supported by the parallel provider");
        expect(requests).toHaveLength(1);
        expectRequest(requests[0], "POST", "/v1/search", "test-key");
        expect(requests[0]?.jsonBody).toEqual({
          query: "test query",
          provider: "exa",
          mode: "fast",
        });
      },
    );
  });

  it("search rejects non-integer num-results values", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--num-results",
      "abc",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--num-results");
  });

  it("search writes results to an output file", async () => {
    const outputDir = await createTempDir("browse-search-output-");
    const outputPath = join(outputDir, "results.json");

    await withServer(
      async (_request, response) => {
        jsonResponse(
          response,
          200,
          makeSearchResponse("test", [
            { id: "res_1", url: "https://example.com", title: "Example" },
          ]),
        );
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test",
          "--output",
          outputPath,
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          ok: true,
          outputPath,
          query: "test",
          resultCount: 1,
        });
        const written = JSON.parse(await readFile(outputPath, "utf8")) as {
          query: string;
        };
        expect(written.query).toBe("test");
      },
    );
  });

  it("search output file can print a human-readable confirmation", async () => {
    const outputDir = await createTempDir("browse-search-output-");
    const outputPath = join(outputDir, "results.json");

    await withServer(
      async (_request, response) => {
        jsonResponse(
          response,
          200,
          makeSearchResponse("test", [
            { id: "res_1", url: "https://example.com", title: "Example" },
          ]),
        );
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test",
          "--output",
          outputPath,
          "--format",
          "table",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain(`Wrote 1 results for "test" to ${outputPath}.`);
        const written = JSON.parse(await readFile(outputPath, "utf8")) as {
          query: string;
        };
        expect(written.query).toBe("test");
      },
    );
  });

  it("search can print a human-readable table", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(
          response,
          200,
          makeSearchResponse("test", [
            {
              author: "Example Author",
              id: "res_1",
              publishedDate: "2026-05-17T00:00:00.000Z",
              title: "Example Result",
              url: "https://example.com/result",
            },
          ]),
        );
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test",
          "--format",
          "table",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("Title");
        expect(result.stdout).toContain("Example Result");
        expect(result.stdout).toContain("https://example.com/result");
        expect(result.stdout).toContain("2026-05-17");
        expect(result.stdout).toContain("Example Author");
      },
    );
  });

  it.each([
    {
      name: "include-domains",
      args: ["--include-domains", "example.com,docs.example.com"],
      expected: { includeDomains: ["example.com", "docs.example.com"] },
    },
    {
      name: "exclude-domains",
      args: ["--exclude-domains", "spam.com,ads.net"],
      expected: { excludeDomains: ["spam.com", "ads.net"] },
    },
    {
      name: "start-published-date with time",
      args: ["--start-published-date", "2026-01-15T12:00:00Z"],
      expected: { startPublishedDate: "2026-01-15T12:00:00Z" },
    },
    {
      name: "start-published-date without time",
      args: ["--start-published-date", "2026-01-15"],
      expected: { startPublishedDate: "2026-01-15T00:00:00Z" },
    },
    {
      name: "end-published-date (Exa)",
      args: ["--provider", "exa", "--end-published-date", "2026-06-01"],
      expected: { provider: "exa", endPublishedDate: "2026-06-01T00:00:00Z" },
    },
    {
      name: "category (Exa)",
      args: ["--provider", "exa", "--category", "news"],
      expected: { provider: "exa", category: "news" },
    },
    {
      name: "user-location",
      args: ["--user-location", "us"],
      expected: { userLocation: "US" },
    },
    {
      name: "objective",
      args: ["--objective", "Find developer documentation"],
      expected: { objective: "Find developer documentation" },
    },
    {
      name: "max-age-hours",
      args: ["--max-age-hours", "24"],
      expected: { maxAgeHours: 24 },
    },
    {
      name: "excerpts",
      args: ["--excerpts"],
      expected: { excerpts: true },
    },
    {
      name: "moderation (Exa)",
      args: ["--provider", "exa", "--moderation"],
      expected: { provider: "exa", moderation: true },
    },
    {
      name: "Exa deep mode",
      args: ["--provider", "exa", "--mode", "deep"],
      expected: { provider: "exa", mode: "deep" },
    },
    {
      name: "Exa deep-lite mode",
      args: ["--provider", "exa", "--mode", "deep-lite"],
      expected: { provider: "exa", mode: "deep-lite" },
    },
  ])("search sends new param $name in POST body", async ({ args, expected }) => {
    await withServer(
      async (_request, response) => {
        jsonResponse(
          response,
          200,
          makeSearchResponse("test query", [
            { id: "res_1", url: "https://example.com", title: "Example" },
          ]),
        );
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test query",
          ...args,
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(requests).toHaveLength(1);
        expectRequest(requests[0], "POST", "/v1/search", "test-key");
        expect(requests[0]?.jsonBody).toMatchObject({
          query: "test query",
          ...expected,
        });
      },
    );
  });

  it("search accepts include+exclude domains without explicit provider (API auto-routes)", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeSearchResponse("test", []));
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test query",
          "--include-domains",
          "bbc.com,nytimes.com",
          "--exclude-domains",
          "cnn.com",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(requests).toHaveLength(1);
        expect(requests[0]?.jsonBody).toMatchObject({
          includeDomains: ["bbc.com", "nytimes.com"],
          excludeDomains: ["cnn.com"],
        });
      },
    );
  });

  it("search rejects both include+exclude domains with explicit --provider parallel", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--provider",
      "parallel",
      "--include-domains",
      "example.com",
      "--exclude-domains",
      "spam.com",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("does not support both");
  });

  it("search accepts 201 domains without explicit provider (API auto-routes)", async () => {
    const domains = Array.from({ length: 201 }, (_, i) => `domain${i}.com`).join(",");
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeSearchResponse("test", []));
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test query",
          "--include-domains",
          domains,
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(requests).toHaveLength(1);
      },
    );
  });

  it("search rejects more than 200 domains with explicit --provider parallel", async () => {
    const domains = Array.from({ length: 201 }, (_, i) => `domain${i}.com`).join(",");
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--provider",
      "parallel",
      "--include-domains",
      domains,
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("at most 200 domains");
  });

  it("search rejects empty domain list (commas only)", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--include-domains",
      ",",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("no valid domains");
  });

  it("search rejects empty domain list (whitespace)", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--include-domains",
      " , ",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("no valid domains");
  });

  it("search lowercases and deduplicates domains", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeSearchResponse("test", []));
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test query",
          "--include-domains",
          "Example.COM,example.com,OTHER.com",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(requests[0]?.jsonBody).toMatchObject({
          includeDomains: ["example.com", "other.com"],
        });
      },
    );
  });

  it("search rejects domains with scheme", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--include-domains",
      "https://example.com",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("includes a scheme");
  });

  it("search rejects domains with port", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--include-domains",
      "example.com:8080",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("port");
  });

  it("search rejects domains with port in path prefix", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--include-domains",
      "bbc.com:443/news",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("port");
  });

  it("search rejects domains with query string", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--include-domains",
      "example.com?foo=bar",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("query string or fragment");
  });

  it("search infers exa provider for deep mode", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeSearchResponse("test", []));
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test query",
          "--mode",
          "deep",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(requests[0]?.jsonBody).toMatchObject({
          provider: "exa",
          mode: "deep",
        });
      },
    );
  });

  it("search infers exa provider for deep-lite mode", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeSearchResponse("test", []));
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test query",
          "--mode",
          "deep-lite",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(requests[0]?.jsonBody).toMatchObject({
          provider: "exa",
          mode: "deep-lite",
        });
      },
    );
  });

  it("search rejects --mode without --provider for non-deep modes", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--mode",
      "fast",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--mode requires --provider");
  });

  it("search rejects deep mode with explicit --provider parallel", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--provider",
      "parallel",
      "--mode",
      "deep",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("does not support --mode deep");
  });

  it("search rejects advanced mode with --provider exa", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--provider",
      "exa",
      "--mode",
      "advanced",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("does not support --mode advanced");
  });

  it("search rejects Exa-only flags with --provider parallel", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--provider",
      "parallel",
      "--end-published-date",
      "2026-12-31",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("only supported with --provider exa");
  });

  it("search accepts user-location IE without explicit provider (API auto-routes)", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeSearchResponse("test", []));
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test query",
          "--user-location",
          "IE",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(requests[0]?.jsonBody).toMatchObject({
          userLocation: "IE",
        });
      },
    );
  });

  it("search rejects invalid user-location code format", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--user-location",
      "USA",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("two-letter country code");
  });

  it("search rejects unsupported country code with explicit --provider parallel", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--provider",
      "parallel",
      "--user-location",
      "ZZ",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('does not support country code "ZZ"');
  });

  it("search accepts any country code with --provider exa", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeSearchResponse("test", []));
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test query",
          "--provider",
          "exa",
          "--user-location",
          "ZZ",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(requests[0]?.jsonBody).toMatchObject({
          provider: "exa",
          userLocation: "ZZ",
        });
      },
    );
  });

  it("search rejects empty objective", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--objective",
      "",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("cannot be empty");
  });

  it("search rejects whitespace-only objective", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--objective",
      "   ",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("cannot be empty");
  });

  it("search rejects invalid date format", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--start-published-date",
      "10/01/2026",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("must be YYYY-MM-DD or RFC 3339");
  });

  it("search rejects invalid date values", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--start-published-date",
      "2026-02-30",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid date");
  });

  it("search rejects partial date format", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--start-published-date",
      "2026-10",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("must be YYYY-MM-DD or RFC 3339");
  });

  it("search accepts lowercase t and z in date-time", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, makeSearchResponse("test", []));
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test query",
          "--provider",
          "exa",
          "--start-published-date",
          "2026-10-01t12:00:00z",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(requests[0]?.jsonBody).toMatchObject({
          startPublishedDate: "2026-10-01T12:00:00Z",
        });
      },
    );
  });

  it("search rejects start date after end date", async () => {
    const result = await runCli([
      "cloud",
      "search",
      "test query",
      "--provider",
      "exa",
      "--start-published-date",
      "2026-12-01",
      "--end-published-date",
      "2026-01-01",
      "--api-key",
      "test-key",
      "--base-url",
      "http://127.0.0.1:1",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("cannot be after");
  });

  it("search includes provider and mode in JSON output", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, {
          ...makeSearchResponse("test", [
            { id: "res_1", url: "https://example.com", title: "Example" },
          ]),
          provider: "parallel",
          mode: "advanced",
        });
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test query",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout) as {
          provider: string;
          mode: string;
        };
        expect(output.provider).toBe("parallel");
        expect(output.mode).toBe("advanced");
      },
    );
  });

  it("search includes excerpts in results when requested", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, {
          ...makeSearchResponse("test", [
            {
              id: "res_1",
              url: "https://example.com",
              title: "Example",
              excerpts: ["First relevant passage.", "Second relevant passage."],
            },
          ]),
        });
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test query",
          "--excerpts",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout) as {
          results: Array<{ excerpts?: string[] }>;
        };
        expect(output.results[0]?.excerpts).toEqual([
          "First relevant passage.",
          "Second relevant passage.",
        ]);
      },
    );
  });

  it("search table output shows excerpts when requested", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, {
          ...makeSearchResponse("test", [
            {
              id: "res_1",
              url: "https://example.com",
              title: "Example Result",
              excerpts: ["This is the most relevant passage from the page."],
            },
          ]),
        });
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test query",
          "--excerpts",
          "--format",
          "table",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("Example Result");
        expect(result.stdout).toContain("Excerpts:");
        expect(result.stdout).toContain("most relevant passage");
      },
    );
  });

  it("search output file includes provider and mode in confirmation", async () => {
    const outputDir = await createTempDir("browse-search-output-");
    const outputPath = join(outputDir, "results.json");

    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, {
          ...makeSearchResponse("test", [
            { id: "res_1", url: "https://example.com", title: "Example" },
          ]),
          provider: "exa",
          mode: "fast",
        });
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "search",
          "test",
          "--output",
          outputPath,
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout) as {
          provider: string;
          mode: string;
        };
        expect(output.provider).toBe("exa");
        expect(output.mode).toBe("fast");
      },
    );
  });

  it.each([
    {
      args: ["cloud", "projects", "list"],
      expectedMethod: "GET",
      expectedPath: "/v1/projects",
      responseBody: [{ id: "proj_123", name: "Demo" }],
    },
    {
      args: ["cloud", "projects", "get", "proj_123"],
      expectedMethod: "GET",
      expectedPath: "/v1/projects/proj_123",
      responseBody: { id: "proj_123", name: "Demo" },
    },
    {
      args: ["cloud", "projects", "usage", "proj_123"],
      expectedMethod: "GET",
      expectedPath: "/v1/projects/proj_123/usage",
      responseBody: { browserMinutes: 1, proxyBytes: 2 },
    },
  ])("projects contract: %j", async ({ args, expectedMethod, expectedPath, responseBody }) => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, responseBody);
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([...args, "--api-key", "test-key", "--base-url", baseUrl]);

        expect(result.exitCode).toBe(0);
        expectRequest(requests[0], expectedMethod, expectedPath, "test-key");
      },
    );
  });

  it("projects list can print a human-readable table", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, [
          {
            concurrency: 10,
            createdAt: "2026-05-17T07:45:06.376Z",
            defaultTimeout: 900,
            id: "proj_123456789",
            name: "Demo Project",
          },
        ]);
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "projects",
          "list",
          "--format",
          "table",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("Concurrency");
        expect(result.stdout).toContain("proj_123");
        expect(result.stdout).toContain("Demo Project");
        expect(result.stdout).toContain("900");
        expect(result.stdout).toContain("2026-05-17 07:45Z");
      },
    );
  });

  it("loads Browserbase API config from .env", async () => {
    const cwd = await createTempDir("browse-dotenv-api-config-");

    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, [{ id: "proj_123", name: "Demo" }]);
      },
      async ({ baseUrl, requests }) => {
        await writeFile(
          join(cwd, ".env"),
          ["BROWSERBASE_API_KEY=test-key", `BROWSERBASE_BASE_URL=${baseUrl}`].join("\n"),
        );

        const result = await runCli(["cloud", "projects", "list"], {
          cwd,
          env: {
            BROWSERBASE_API_KEY: undefined,
            BROWSERBASE_BASE_URL: undefined,
          },
        });

        expect(result.exitCode).toBe(0);
        expectRequest(requests[0], "GET", "/v1/projects", "test-key");
      },
    );
  });

  it("warns on stderr when auto-loading .env variables with BROWSE_LOAD_DOTENV unset", async () => {
    const cwd = await createTempDir("browse-dotenv-warn-");

    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, [{ id: "proj_123", name: "Demo" }]);
      },
      async ({ baseUrl, requests }) => {
        await writeFile(
          join(cwd, ".env"),
          ["BROWSERBASE_API_KEY=test-key", `BROWSERBASE_BASE_URL=${baseUrl}`].join("\n"),
        );

        const result = await runCli(["cloud", "projects", "list"], {
          cwd,
          env: {
            BROWSERBASE_API_KEY: undefined,
            BROWSERBASE_BASE_URL: undefined,
            BROWSE_LOAD_DOTENV: undefined,
          },
        });

        expect(result.exitCode).toBe(0);
        expectRequest(requests[0], "GET", "/v1/projects", "test-key");
        expect(result.stderr).toContain("deprecated");
        expect(result.stderr).toContain("BROWSERBASE_API_KEY");
      },
    );
  });

  it("does not warn when BROWSE_LOAD_DOTENV=1 is explicitly set", async () => {
    const cwd = await createTempDir("browse-dotenv-optin-");

    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, [{ id: "proj_123", name: "Demo" }]);
      },
      async ({ baseUrl, requests }) => {
        await writeFile(
          join(cwd, ".env"),
          ["BROWSERBASE_API_KEY=test-key", `BROWSERBASE_BASE_URL=${baseUrl}`].join("\n"),
        );

        const result = await runCli(["cloud", "projects", "list"], {
          cwd,
          env: {
            BROWSERBASE_API_KEY: undefined,
            BROWSERBASE_BASE_URL: undefined,
            BROWSE_LOAD_DOTENV: "1",
          },
        });

        expect(result.exitCode).toBe(0);
        expectRequest(requests[0], "GET", "/v1/projects", "test-key");
        expect(result.stderr).not.toContain("deprecated");
      },
    );
  });

  it.each(["0", "false", "no", "FALSE", "NO"])(
    "does not auto-load .env when BROWSE_LOAD_DOTENV=%s",
    async (optOutValue) => {
      const cwd = await createTempDir("browse-dotenv-optout-");

      await writeFile(join(cwd, ".env"), "BROWSERBASE_API_KEY=test-key\n");

      const result = await runCli(["cloud", "projects", "list"], {
        cwd,
        env: {
          BROWSERBASE_API_KEY: undefined,
          BROWSERBASE_BASE_URL: undefined,
          BROWSE_LOAD_DOTENV: optOutValue,
        },
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Missing Browserbase API key");
      expect(result.stderr).not.toContain("deprecated");
    },
  );

  it.each([
    {
      args: ["cloud", "contexts", "create", "--body", '{"region":"us-west-2"}'],
      expectedMethod: "POST",
      expectedPath: "/v1/contexts",
      expectedBody: { region: "us-west-2" },
      responseBody: { id: "ctx_123" },
    },
    {
      args: ["cloud", "contexts", "get", "00000000-0000-4000-8000-000000000000"],
      expectedMethod: "GET",
      expectedPath: "/v1/contexts/00000000-0000-4000-8000-000000000000",
      expectedBody: undefined,
      responseBody: { id: "00000000-0000-4000-8000-000000000000" },
    },
    {
      args: ["cloud", "contexts", "delete", "00000000-0000-4000-8000-000000000000"],
      expectedMethod: "DELETE",
      expectedPath: "/v1/contexts/00000000-0000-4000-8000-000000000000",
      expectedBody: undefined,
      responseBody: null,
    },
  ])(
    "contexts contract: %j",
    async ({ args, expectedMethod, expectedPath, expectedBody, responseBody }) => {
      await withServer(
        async (_request, response) => {
          if (responseBody === null) {
            response.writeHead(204);
            response.end();
            return;
          }
          jsonResponse(response, 200, responseBody);
        },
        async ({ baseUrl, requests }) => {
          const result = await runCli([...args, "--api-key", "test-key", "--base-url", baseUrl]);

          expect(result.exitCode).toBe(0);
          expectRequest(requests[0], expectedMethod, expectedPath, "test-key");
          if (expectedBody) {
            expect(requests[0]?.jsonBody).toMatchObject(expectedBody);
          }
        },
      );
    },
  );

  it.each([
    {
      args: ["cloud", "extensions", "get", "ext_123"],
      expectedMethod: "GET",
      expectedPath: "/v1/extensions/ext_123",
      responseBody: { id: "ext_123" },
    },
    {
      args: ["cloud", "extensions", "delete", "ext_123"],
      expectedMethod: "DELETE",
      expectedPath: "/v1/extensions/ext_123",
      responseBody: null,
    },
  ])(
    "extensions get/delete contract: %j",
    async ({ args, expectedMethod, expectedPath, responseBody }) => {
      await withServer(
        async (_request, response) => {
          if (responseBody === null) {
            response.writeHead(204);
            response.end();
            return;
          }
          jsonResponse(response, 200, responseBody);
        },
        async ({ baseUrl, requests }) => {
          const result = await runCli([...args, "--api-key", "test-key", "--base-url", baseUrl]);

          expect(result.exitCode).toBe(0);
          expectRequest(requests[0], expectedMethod, expectedPath, "test-key");
        },
      );
    },
  );

  it("extensions upload uses multipart form data", async () => {
    const fixtureDir = await createTempDir("browse-extension-upload-");
    const fixturePath = join(fixtureDir, "extension.zip");
    await writeFile(fixturePath, "zip-content");

    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, { id: "ext_123" });
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "extensions",
          "upload",
          fixturePath,
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expectRequest(requests[0], "POST", "/v1/extensions", "test-key");
        expect(requests[0]?.headers["content-type"]).toContain("multipart/form-data");
        expect(requests[0]?.bodyText).toContain('filename="extension.zip"');
      },
    );
  });

  it("extensions upload --stagehand uploads the bundled Stagehand extension", async () => {
    const expectedArchive = Buffer.from(await getExtensionArchive());

    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, { id: "ext_stagehand" });
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "extensions",
          "upload",
          "--stagehand",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expectRequest(requests[0], "POST", "/v1/extensions", "test-key");
        expect(requests[0]?.headers["content-type"]).toContain("multipart/form-data");
        expect(requests[0]?.bodyText).toContain('filename="stagehand-extension.zip"');

        const bodyBuffer = requests[0]?.bodyBuffer;
        expect(bodyBuffer).toBeDefined();
        expect(bodyBuffer!.includes(expectedArchive)).toBe(true);
      },
    );
  });

  it("extensions upload rejects both --stagehand and a file path", async () => {
    const result = await runCli([
      "cloud",
      "extensions",
      "upload",
      "--stagehand",
      "./extension.zip",
      "--api-key",
      "test-key",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Cannot specify both --stagehand and a file path");
  });

  it("extensions upload requires --stagehand or a file path", async () => {
    const result = await runCli(["cloud", "extensions", "upload", "--api-key", "test-key"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Provide a file path or use --stagehand");
  });

  it("sessions create uploads the Stagehand extension by default", async () => {
    const expectedArchive = Buffer.from(await getExtensionArchive());
    let extensionUploadCount = 0;

    await withServer(
      async (request, response) => {
        if (request.method === "POST" && request.path === "/v1/extensions") {
          extensionUploadCount++;
          jsonResponse(response, 200, { id: "ext_auto_stagehand" });
        } else if (request.method === "POST" && request.path === "/v1/sessions") {
          jsonResponse(response, 200, { id: "sess_123", connectUrl: "ws://example.com" });
        } else {
          textResponse(response, 404, "Not Found");
        }
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "create",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);

        // Should have uploaded the extension first
        expect(extensionUploadCount).toBe(1);
        const uploadRequest = requests.find((r) => r.path === "/v1/extensions");
        expect(uploadRequest).toBeDefined();
        expect(uploadRequest?.method).toBe("POST");
        expect(uploadRequest?.headers["content-type"]).toContain("multipart/form-data");
        expect(uploadRequest?.bodyText).toContain('filename="stagehand-extension.zip"');
        expect(uploadRequest?.bodyBuffer!.includes(expectedArchive)).toBe(true);

        // Should have created the session with the extension ID
        const sessionRequest = requests.find((r) => r.path === "/v1/sessions");
        expect(sessionRequest).toBeDefined();
        expect(sessionRequest?.method).toBe("POST");
        expect(sessionRequest?.jsonBody).toMatchObject({ extensionId: "ext_auto_stagehand" });
      },
    );
  });

  it("sessions create skips extension upload when --extension-id is provided", async () => {
    let extensionUploadCount = 0;

    await withServer(
      async (request, response) => {
        if (request.method === "POST" && request.path === "/v1/extensions") {
          extensionUploadCount++;
          jsonResponse(response, 200, { id: "ext_should_not_upload" });
        } else if (request.method === "POST" && request.path === "/v1/sessions") {
          jsonResponse(response, 200, { id: "sess_123", connectUrl: "ws://example.com" });
        } else {
          textResponse(response, 404, "Not Found");
        }
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "create",
          "--extension-id",
          "ext_user_provided",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);

        // Should NOT have uploaded an extension
        expect(extensionUploadCount).toBe(0);

        // Should have created the session with the user-provided extension ID
        const sessionRequest = requests.find((r) => r.path === "/v1/sessions");
        expect(sessionRequest).toBeDefined();
        expect(sessionRequest?.jsonBody).toMatchObject({ extensionId: "ext_user_provided" });
      },
    );
  });

  it("sessions create skips extension upload when --no-stagehand-extension is set", async () => {
    let extensionUploadCount = 0;

    await withServer(
      async (request, response) => {
        if (request.method === "POST" && request.path === "/v1/extensions") {
          extensionUploadCount++;
          jsonResponse(response, 200, { id: "ext_should_not_upload" });
        } else if (request.method === "POST" && request.path === "/v1/sessions") {
          jsonResponse(response, 200, { id: "sess_123", connectUrl: "ws://example.com" });
        } else {
          textResponse(response, 404, "Not Found");
        }
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "create",
          "--no-stagehand-extension",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);

        // Should NOT have uploaded an extension
        expect(extensionUploadCount).toBe(0);

        // Should have created the session without an extension ID
        const sessionRequest = requests.find((r) => r.path === "/v1/sessions");
        expect(sessionRequest).toBeDefined();
        expect(sessionRequest?.jsonBody?.extensionId).toBeUndefined();
      },
    );
  });

  it("sessions create continues without extension when upload fails", async () => {
    await withServer(
      async (request, response) => {
        if (request.method === "POST" && request.path === "/v1/extensions") {
          // Simulate extension upload failure
          textResponse(response, 500, "Internal Server Error");
        } else if (request.method === "POST" && request.path === "/v1/sessions") {
          jsonResponse(response, 200, { id: "sess_123", connectUrl: "ws://example.com" });
        } else {
          textResponse(response, 404, "Not Found");
        }
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "create",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        // Session creation should succeed even though extension upload failed
        expect(result.exitCode).toBe(0);

        // Should have attempted extension upload
        const uploadRequest = requests.find((r) => r.path === "/v1/extensions");
        expect(uploadRequest).toBeDefined();

        // Should have created session without extension ID
        const sessionRequest = requests.find((r) => r.path === "/v1/sessions");
        expect(sessionRequest).toBeDefined();
        expect(sessionRequest?.jsonBody?.extensionId).toBeUndefined();

        // Should have printed warning to stderr
        expect(result.stderr).toContain("Warning: Stagehand extension upload failed");
      },
    );
  });

  it.each([
    {
      args: ["cloud", "sessions", "list", "--q", "status:RUNNING"],
      expectedMethod: "GET",
      expectedPath: "/v1/sessions?q=status%3ARUNNING",
      expectedBody: undefined,
      responseBody: [],
    },
    {
      args: ["cloud", "sessions", "get", "sess_123"],
      expectedMethod: "GET",
      expectedPath: "/v1/sessions/sess_123",
      expectedBody: undefined,
      responseBody: { id: "sess_123" },
    },
    {
      args: [
        "cloud",
        "sessions",
        "create",
        "--no-stagehand-extension",
        "--body",
        '{"keepAlive":true}',
      ],
      expectedMethod: "POST",
      expectedPath: "/v1/sessions",
      expectedBody: { keepAlive: true },
      responseBody: { id: "sess_123", connectUrl: "ws://example.com" },
    },
    {
      args: ["cloud", "sessions", "update", "sess_123"],
      expectedMethod: "POST",
      expectedPath: "/v1/sessions/sess_123",
      expectedBody: { status: "REQUEST_RELEASE" },
      responseBody: { id: "sess_123", status: "REQUEST_RELEASE" },
    },
    {
      args: ["cloud", "sessions", "debug", "sess_123"],
      expectedMethod: "GET",
      expectedPath: "/v1/sessions/sess_123/debug",
      expectedBody: undefined,
      responseBody: { debuggerUrl: "https://example.com" },
    },
    {
      args: ["cloud", "sessions", "logs", "sess_123"],
      expectedMethod: "GET",
      expectedPath: "/v1/sessions/sess_123/logs",
      expectedBody: undefined,
      responseBody: [],
    },
  ])(
    "sessions contract: %j",
    async ({ args, expectedMethod, expectedPath, expectedBody, responseBody }) => {
      await withServer(
        async (_request, response) => {
          jsonResponse(response, 200, responseBody);
        },
        async ({ baseUrl, requests }) => {
          const result = await runCli([...args, "--api-key", "test-key", "--base-url", baseUrl]);

          expect(result.exitCode).toBe(0);
          expectRequest(requests[0], expectedMethod, expectedPath, "test-key");
          if (expectedBody) {
            expect(requests[0]?.jsonBody).toMatchObject(expectedBody);
          }
        },
      );
    },
  );

  it("sessions list sends q and status filters", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, []);
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "list",
          "--q",
          "user_metadata['env']:'staging'",
          "--status",
          "RUNNING",
          "--json",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(requests[0]?.method).toBe("GET");
        expect(requests[0]?.headers["x-bb-api-key"]).toBe("test-key");

        const url = new URL(requests[0]?.path ?? "/", "http://localhost");
        expect(url.pathname).toBe("/v1/sessions");
        expect(url.searchParams.get("q")).toBe("user_metadata['env']:'staging'");
        expect(url.searchParams.get("status")).toBe("RUNNING");
      },
    );
  });

  it("sessions list can print a limited human-readable table", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, [
          makeSessionResponse("sess_11111111", "COMPLETED"),
          makeSessionResponse("sess_22222222", "RUNNING"),
          makeSessionResponse("sess_33333333", "ERROR"),
        ]);
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "list",
          "--format",
          "table",
          "--limit",
          "2",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("Status");
        expect(result.stdout).toContain("sess_111");
        expect(result.stdout).toContain("COMPLETED");
        expect(result.stdout).toContain("sess_222");
        expect(result.stdout).toContain("RUNNING");
        expect(result.stdout).not.toContain("sess_333");
        expect(result.stdout).toContain("Showing 2 of 3 sessions returned");
      },
    );
  });

  it("sessions list table formats durations without rounding up units", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, [
          {
            ...makeSessionResponse("sess_11111111", "COMPLETED"),
            endedAt: "2026-05-17T08:44:36.376Z",
            startedAt: "2026-05-17T07:45:06.376Z",
          },
          {
            ...makeSessionResponse("sess_22222222", "COMPLETED"),
            endedAt: "2026-05-17T09:15:06.376Z",
            startedAt: "2026-05-17T07:45:06.376Z",
          },
        ]);
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "list",
          "--format",
          "table",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("59m");
        expect(result.stdout).toContain("1h");
        expect(result.stdout).not.toContain("2h");
      },
    );
  });

  it("sessions list table renders missing keepAlive as unknown", async () => {
    await withServer(
      async (_request, response) => {
        const session = makeSessionResponse("sess_11111111", "COMPLETED");
        delete (session as { keepAlive?: boolean }).keepAlive;
        jsonResponse(response, 200, [session]);
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "list",
          "--format",
          "table",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toMatch(
          /sess_111\s+COMPLETED\s+2026-05-17 07:45Z\s+2s\s+us-west-2\s+-\s+-\s+browse_cli,source=test/,
        );
      },
    );
  });

  it("sessions list --all shows every returned session in table output", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, [
          makeSessionResponse("sess_11111111", "COMPLETED"),
          makeSessionResponse("sess_22222222", "RUNNING"),
        ]);
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "list",
          "--format",
          "table",
          "--all",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("sess_111");
        expect(result.stdout).toContain("sess_222");
        expect(result.stdout).not.toContain("Showing");
      },
    );
  });

  it("sessions list --json prints the full returned payload", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, [makeSessionResponse("sess_11111111")]);
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "list",
          "--json",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout) as Array<{ id: string }>;
        expect(output).toHaveLength(1);
        expect(output[0]?.id).toBe("sess_11111111");
      },
    );
  });

  it("sessions create merges body JSON with ergonomic flags", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, { id: "sess_123" });
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "create",
          "--no-stagehand-extension",
          "--body",
          '{"keepAlive":true,"browserSettings":{"context":{"id":"ctx_123"},"size":"regular"}}',
          "--size",
          "large",
          "--proxies",
          "--verified",
          "--solve-captchas",
          "--viewport",
          "1280x720",
          "--persist",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expectRequest(requests[0], "POST", "/v1/sessions", "test-key");
        expect(requests[0]?.jsonBody).toMatchObject({
          keepAlive: true,
          proxies: true,
          browserSettings: {
            verified: true,
            solveCaptchas: true,
            viewport: { width: 1280, height: 720 },
            size: "large",
            context: { id: "ctx_123", persist: true },
          },
        });
      },
    );
  });

  it.each([
    { name: "regular", args: ["--no-stagehand-extension", "--size", "regular"], size: "regular" },
    { name: "xlarge", args: ["--no-stagehand-extension", "--size", "xlarge"], size: "xlarge" },
    { name: "omitted", args: ["--no-stagehand-extension"], size: undefined },
    {
      name: "body only",
      args: ["--no-stagehand-extension", "--body", '{"browserSettings":{"size":"large"}}'],
      size: "large",
    },
  ])("sessions create forwards size: $name", async ({ args, size }) => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, { id: "sess_123" });
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "create",
          ...args,
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(requests).toHaveLength(1);
        expectRequest(requests[0], "POST", "/v1/sessions", "test-key");
        if (size === undefined) {
          expect(requests[0]?.jsonBody).not.toHaveProperty("browserSettings");
        } else {
          expect(requests[0]?.jsonBody).toHaveProperty("browserSettings", { size });
        }
      },
    );
  });

  it("sessions create rejects invalid sizes before making a request", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, { id: "sess_123" });
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "create",
          "--no-stagehand-extension",
          "--size",
          "medium",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("--size");
        expect(requests).toHaveLength(0);
      },
    );
  });

  it("sessions create accepts --advanced-stealth as a hidden alias for verified browser mode", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, { id: "sess_123" });
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "create",
          "--no-stagehand-extension",
          "--advanced-stealth",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expectRequest(requests[0], "POST", "/v1/sessions", "test-key");
        expect(requests[0]?.jsonBody).toMatchObject({
          browserSettings: {
            verified: true,
          },
        });
      },
    );
  });

  it("sessions create tags userMetadata with browse_cli, cli_version, and install_id", async () => {
    const idDir = await createTempDir("browse-create-install-id-");
    const installIdFile = join(idDir, "telemetry-id");
    await writeFile(installIdFile, "create-install-uuid-123\n", "utf8");

    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, { id: "sess_123" });
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli(
          [
            "cloud",
            "sessions",
            "create",
            "--no-stagehand-extension",
            "--api-key",
            "test-key",
            "--base-url",
            baseUrl,
          ],
          { env: { BROWSERBASE_TELEMETRY_INSTALL_ID_FILE: installIdFile } },
        );

        expect(result.exitCode).toBe(0);
        expectRequest(requests[0], "POST", "/v1/sessions", "test-key");
        const body = requests[0]?.jsonBody as {
          userMetadata?: Record<string, string>;
        };
        expect(body.userMetadata).toBeDefined();
        expect(body.userMetadata?.browse_cli).toBe("true");
        expect(body.userMetadata?.cli_version).toBeDefined();
        expect(body.userMetadata?.cli_version).not.toBe("unknown");
        expect(body.userMetadata?.install_id).toBe("create-install-uuid-123");
      },
    );
  });

  it("sessions create preserves user-supplied metadata but keeps attribution keys authoritative", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, { id: "sess_123" });
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "create",
          "--no-stagehand-extension",
          // User-supplied metadata: a custom key is kept; an attempt to override
          // browse_cli must lose to our authoritative attribution value.
          "--body",
          '{"userMetadata":{"env":"staging","browse_cli":"false"}}',
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expectRequest(requests[0], "POST", "/v1/sessions", "test-key");
        const body = requests[0]?.jsonBody as {
          userMetadata?: Record<string, string>;
        };
        expect(body.userMetadata?.env).toBe("staging");
        expect(body.userMetadata?.browse_cli).toBe("true");
        expect(body.userMetadata?.cli_version).not.toBe("unknown");
      },
    );
  });

  it("sessions create strips caller-supplied install_id to prevent spoofing", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, { id: "sess_123" });
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli(
          [
            "cloud",
            "sessions",
            "create",
            "--no-stagehand-extension",
            "--body",
            '{"userMetadata":{"install_id":"spoofed-id","env":"test"}}',
            "--api-key",
            "test-key",
            "--base-url",
            baseUrl,
          ],
          {
            env: {
              BROWSERBASE_TELEMETRY_INSTALL_ID_FILE: "/tmp/no-such-file-browse-test",
            },
          },
        );

        expect(result.exitCode).toBe(0);
        expectRequest(requests[0], "POST", "/v1/sessions", "test-key");
        const body = requests[0]?.jsonBody as {
          userMetadata?: Record<string, string>;
        };
        expect(body.userMetadata?.env).toBe("test");
        expect(body.userMetadata?.install_id).not.toBe("spoofed-id");
      },
    );
  });

  it("sessions update merges an explicit status flag into the request body", async () => {
    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, {
          id: "sess_123",
          status: "REQUEST_RELEASE",
        });
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "update",
          "sess_123",
          "--status",
          "REQUEST_RELEASE",
          "--body",
          '{"userMetadata":{"source":"test"}}',
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expectRequest(requests[0], "POST", "/v1/sessions/sess_123", "test-key");
        expect(requests[0]?.jsonBody).toMatchObject({
          status: "REQUEST_RELEASE",
          userMetadata: {
            source: "test",
          },
        });
      },
    );
  });

  it("sessions downloads get writes a binary artifact to disk", async () => {
    const outputDir = await createTempDir("browse-session-download-");
    const outputPath = join(outputDir, "downloads.zip");

    await withServer(
      async (_request, response) => {
        binaryResponse(response, 200, Buffer.from("zip-bytes"), "application/zip");
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "downloads",
          "get",
          "sess_123",
          "--output",
          outputPath,
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expectRequest(requests[0], "GET", "/v1/sessions/sess_123/downloads", "test-key");
        expect(await readFile(outputPath, "utf8")).toBe("zip-bytes");
      },
    );
  });

  it("sessions uploads create uses multipart form data", async () => {
    const fixtureDir = await createTempDir("browse-session-upload-");
    const fixturePath = join(fixtureDir, "upload.txt");
    await writeFile(fixturePath, "upload body");

    await withServer(
      async (_request, response) => {
        jsonResponse(response, 200, { message: "uploaded" });
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "cloud",
          "sessions",
          "uploads",
          "create",
          "sess_123",
          fixturePath,
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expectRequest(requests[0], "POST", "/v1/sessions/sess_123/uploads", "test-key");
        expect(requests[0]?.headers["content-type"]).toContain("multipart/form-data");
        expect(requests[0]?.bodyText).toContain('filename="upload.txt"');
      },
    );
  });
});

async function withServer(
  handler: (
    request: CapturedRequest,
    response: Parameters<typeof jsonResponse>[0],
  ) => Promise<void> | void,
  callback: (server: Awaited<ReturnType<typeof startFakeBrowserbaseServer>>) => Promise<void>,
): Promise<void> {
  const server = await startFakeBrowserbaseServer(handler);
  try {
    await callback(server);
  } finally {
    await server.close();
  }
}

function expectRequest(
  request: CapturedRequest | undefined,
  method: string,
  path: string,
  apiKey: string,
): void {
  expect(request).toBeDefined();
  expect(request?.method).toBe(method);
  expect(request?.path).toBe(path);
  expect(request?.headers["x-bb-api-key"]).toBe(apiKey);
}

function makeSearchResponse(
  query: string,
  results: Array<{
    author?: string;
    excerpts?: string[];
    id: string;
    publishedDate?: string;
    title: string;
    url: string;
  }>,
) {
  return {
    requestId: "req_123",
    query,
    results,
  };
}

function makeSessionResponse(id: string, status = "COMPLETED") {
  return {
    createdAt: "2026-05-17T07:45:06.376Z",
    endedAt: "2026-05-17T07:45:08.376Z",
    id,
    keepAlive: true,
    region: "us-west-2",
    startedAt: "2026-05-17T07:45:06.376Z",
    status,
    userMetadata: {
      browse_cli: "true",
      source: "test",
    },
  };
}

function makeFetchResponse(content: unknown, contentType = "text/plain") {
  return {
    id: "fetch_123",
    content,
    contentType,
    encoding: "utf-8",
    headers: {
      "content-type": contentType,
    },
    statusCode: 200,
  };
}

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  cleanupPaths.push(directory);
  return directory;
}
