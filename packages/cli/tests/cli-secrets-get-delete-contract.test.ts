import { afterEach, describe, expect, it } from "vitest";
import {
  jsonResponse,
  startFakeBrowserbaseServer,
  type FakeBrowserbaseServer,
} from "./helpers/fake-browserbase-server.js";
import { runCli } from "./helpers/run-cli.js";

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

describe("project secrets get/delete HTTP contracts", () => {
  it("gets metadata by ID and prints the API response", async () => {
    const metadata = { id: "secret-1", secretKey: "SERVICE_TOKEN" };
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, metadata),
    );
    const result = await runCli(
      ["cloud", "secrets", "get", "secret-1", "--base-url", server.baseUrl],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(metadata);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      method: "GET",
      path: "/v1/secrets/secret-1",
      bodyText: "",
      headers: { "x-bb-api-key": "test-key" },
    });
  });

  it("deletes by ID and handles an empty 204 response", async () => {
    server = await startFakeBrowserbaseServer((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    const result = await runCli(
      [
        "cloud",
        "secrets",
        "delete",
        "secret-1",
        "--base-url",
        server.baseUrl,
        "--api-key",
        "override-key",
      ],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      method: "DELETE",
      path: "/v1/secrets/secret-1",
      bodyText: "",
      headers: { "x-bb-api-key": "override-key" },
    });
  });

  it.each(["get", "delete"])(
    "%s escapes the ID as a single URL segment",
    async (command) => {
      server = await startFakeBrowserbaseServer((_request, response) =>
        jsonResponse(response, 200, {}),
      );
      const result = await runCli(
        [
          "cloud",
          "secrets",
          command,
          "id/with?query#fragment",
          "--base-url",
          server.baseUrl,
        ],
        { env },
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]?.path).toBe(
        "/v1/secrets/id%2Fwith%3Fquery%23fragment",
      );
    },
  );

  it.each([
    ["get", 404, "Secret not found"],
    ["delete", 403, "Forbidden"],
  ] as const)("%s reports API errors", async (command, status, message) => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, status, { message }),
    );
    const result = await runCli(
      ["cloud", "secrets", command, "secret-1", "--base-url", server.baseUrl],
      { env },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(message);
  });

  it.each(["get", "delete"])(
    "%s requires a secret ID before requesting",
    async (command) => {
      server = await startFakeBrowserbaseServer((_request, response) =>
        jsonResponse(response, 200, {}),
      );
      const result = await runCli(
        ["cloud", "secrets", command, "--base-url", server.baseUrl],
        { env },
      );
      expect(result.exitCode).not.toBe(0);
      expect(server.requests).toHaveLength(0);
    },
  );
});
