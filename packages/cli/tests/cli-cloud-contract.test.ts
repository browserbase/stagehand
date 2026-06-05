import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
        jsonResponse(
          response,
          200,
          makeFetchResponse({ title: "Example" }, "application/json"),
        );
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
        jsonResponse(
          response,
          200,
          makeFetchResponse("<html>hello</html>", "text/html"),
        );
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
        jsonResponse(
          response,
          200,
          makeFetchResponse({ title: "Example" }, "application/json"),
        );
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
        expect(result.stderr).toContain(
          "--schema is required when --format json.",
        );
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
        expect(result.stderr).toContain(
          "--schema can only be used with --format json.",
        );
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

  it("search sends the expected POST body and prints JSON", async () => {
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
        expect(requests[0]?.jsonBody).toMatchObject({
          query: "test query",
          numResults: 5,
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
        expect(result.stdout).toContain(
          `Wrote 1 results for "test" to ${outputPath}.`,
        );
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
  ])(
    "projects contract: %j",
    async ({ args, expectedMethod, expectedPath, responseBody }) => {
      await withServer(
        async (_request, response) => {
          jsonResponse(response, 200, responseBody);
        },
        async ({ baseUrl, requests }) => {
          const result = await runCli([
            ...args,
            "--api-key",
            "test-key",
            "--base-url",
            baseUrl,
          ]);

          expect(result.exitCode).toBe(0);
          expectRequest(requests[0], expectedMethod, expectedPath, "test-key");
        },
      );
    },
  );

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
          [
            "BROWSERBASE_API_KEY=test-key",
            `BROWSERBASE_BASE_URL=${baseUrl}`,
          ].join("\n"),
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

  it.each([
    {
      args: ["cloud", "contexts", "create", "--body", '{"region":"us-west-2"}'],
      expectedMethod: "POST",
      expectedPath: "/v1/contexts",
      expectedBody: { region: "us-west-2" },
      responseBody: { id: "ctx_123" },
    },
    {
      args: ["cloud", "contexts", "get", "ctx_123"],
      expectedMethod: "GET",
      expectedPath: "/v1/contexts/ctx_123",
      expectedBody: undefined,
      responseBody: { id: "ctx_123" },
    },
    {
      args: ["cloud", "contexts", "update", "ctx_123"],
      expectedMethod: "PUT",
      expectedPath: "/v1/contexts/ctx_123",
      expectedBody: undefined,
      responseBody: { id: "ctx_123", uploadUrl: "https://example.com/upload" },
    },
    {
      args: ["cloud", "contexts", "delete", "ctx_123"],
      expectedMethod: "DELETE",
      expectedPath: "/v1/contexts/ctx_123",
      expectedBody: undefined,
      responseBody: null,
    },
  ])(
    "contexts contract: %j",
    async ({
      args,
      expectedMethod,
      expectedPath,
      expectedBody,
      responseBody,
    }) => {
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
          const result = await runCli([
            ...args,
            "--api-key",
            "test-key",
            "--base-url",
            baseUrl,
          ]);

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
          const result = await runCli([
            ...args,
            "--api-key",
            "test-key",
            "--base-url",
            baseUrl,
          ]);

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
        expect(requests[0]?.headers["content-type"]).toContain(
          "multipart/form-data",
        );
        expect(requests[0]?.bodyText).toContain('filename="extension.zip"');
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
      args: ["cloud", "sessions", "create", "--body", '{"keepAlive":true}'],
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
    async ({
      args,
      expectedMethod,
      expectedPath,
      expectedBody,
      responseBody,
    }) => {
      await withServer(
        async (_request, response) => {
          jsonResponse(response, 200, responseBody);
        },
        async ({ baseUrl, requests }) => {
          const result = await runCli([
            ...args,
            "--api-key",
            "test-key",
            "--base-url",
            baseUrl,
          ]);

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
        expect(url.searchParams.get("q")).toBe(
          "user_metadata['env']:'staging'",
        );
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
          "--body",
          '{"keepAlive":true,"browserSettings":{"context":{"id":"ctx_123"}}}',
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
            context: { id: "ctx_123", persist: true },
          },
        });
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
        binaryResponse(
          response,
          200,
          Buffer.from("zip-bytes"),
          "application/zip",
        );
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
        expectRequest(
          requests[0],
          "GET",
          "/v1/sessions/sess_123/downloads",
          "test-key",
        );
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
        expectRequest(
          requests[0],
          "POST",
          "/v1/sessions/sess_123/uploads",
          "test-key",
        );
        expect(requests[0]?.headers["content-type"]).toContain(
          "multipart/form-data",
        );
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
  callback: (
    server: Awaited<ReturnType<typeof startFakeBrowserbaseServer>>,
  ) => Promise<void>,
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
