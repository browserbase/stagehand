import { afterEach, describe, expect, it } from "vitest";
import {
  jsonResponse,
  startFakeBrowserbaseServer,
  type FakeBrowserbaseServer,
} from "./helpers/fake-browserbase-server.js";
import { runCli } from "./helpers/run-cli.js";

const functionId = "ab76f718-0c41-4130-8b02-c926721801fc";
const env = {
  BROWSERBASE_API_KEY: "test-key",
  BROWSE_LOAD_DOTENV: "0",
  BROWSERBASE_TELEMETRY_DISABLED: "1",
};
let server: FakeBrowserbaseServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("function secrets list HTTP contract", () => {
  it("gets metadata and preserves the pagination response", async () => {
    const page = {
      data: [{ id: "secret-1", secretKey: "SERVICE_TOKEN" }],
      limit: 20,
      nextCursor: "next-page",
    };
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, page),
    );
    const result = await runCli(
      [
        "functions",
        "secrets",
        "list",
        functionId,
        "--base-url",
        server.baseUrl,
      ],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(page);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      method: "GET",
      path: `/v1/functions/${functionId}/secrets`,
      bodyText: "",
      headers: { "x-bb-api-key": "test-key" },
    });
  });

  it("encodes pagination and filters and honors the API key override", async () => {
    const page = { data: [], limit: 2, nextCursor: null };
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, page),
    );
    const result = await runCli(
      [
        "functions",
        "secrets",
        "list",
        functionId,
        "--base-url",
        server.baseUrl,
        "--api-key",
        "override-key",
        "--limit",
        "2",
        "--cursor",
        "a+b/==",
        "--start-at",
        "2026-01-01T00:00:00Z",
        "--end-at",
        "2026-02-01T00:00:00Z",
      ],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(page);
    expect(server.requests).toHaveLength(1);
    const request = server.requests[0]!;
    const url = new URL(request.path, server.baseUrl);
    expect(url.pathname).toBe(`/v1/functions/${functionId}/secrets`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: "2",
      cursor: "a+b/==",
      startAt: "2026-01-01T00:00:00Z",
      endAt: "2026-02-01T00:00:00Z",
    });
    expect(request.headers["x-bb-api-key"]).toBe("override-key");
  });

  it("reports API failures with a failing exit status", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 403, { message: "Forbidden" }),
    );
    const result = await runCli(
      [
        "functions",
        "secrets",
        "list",
        functionId,
        "--base-url",
        server.baseUrl,
      ],
      { env },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Forbidden");
  });

  it.each(["0", "1001"])(
    "rejects invalid limit %s before requesting",
    async (limit) => {
      server = await startFakeBrowserbaseServer((_request, response) =>
        jsonResponse(response, 200, {}),
      );
      const result = await runCli(
        [
          "functions",
          "secrets",
          "list",
          functionId,
          "--base-url",
          server.baseUrl,
          "--limit",
          limit,
        ],
        { env },
      );
      expect(result.exitCode).not.toBe(0);
      expect(server.requests).toHaveLength(0);
    },
  );
});

describe("function secret list argument handling", () => {
  it("requires a function ID before requesting", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, {}),
    );
    const result = await runCli(
      ["functions", "secrets", "list", "--base-url", server.baseUrl],
      { env },
    );
    expect(result.exitCode).not.toBe(0);
    expect(server.requests).toHaveLength(0);
  });

  it("reports a missing function", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 404, { message: "Function not found" }),
    );
    const result = await runCli(
      [
        "functions",
        "secrets",
        "list",
        functionId,
        "--base-url",
        server.baseUrl,
      ],
      { env },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Function not found");
  });
});
