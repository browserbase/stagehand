import { afterEach, describe, expect, it } from "vitest";
import {
  jsonResponse,
  startFakeBrowserbaseServer,
  type FakeBrowserbaseServer,
} from "./helpers/fake-browserbase-server.js";
import { runCli } from "./helpers/run-cli.js";

const functionId = "ab76f718-0c41-4130-8b02-c926721801fc";
const secretId = "d2c4f48f-38e9-4b82-a36a-2b373fd14a65";
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

describe("function secret detach HTTP contract", () => {
  it.each([false, true])(
    "deletes the attachment and handles 204 (key override: %s)",
    async (override) => {
      server = await startFakeBrowserbaseServer((_request, response) => {
        response.writeHead(204);
        response.end();
      });
      const result = await runCli(
        [
          "functions",
          "secrets",
          "detach",
          functionId,
          secretId,
          "--base-url",
          server.baseUrl,
          ...(override ? ["--api-key", "override-key"] : []),
        ],
        { env },
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("");
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]).toMatchObject({
        method: "DELETE",
        path: `/v1/functions/${functionId}/secrets/${secretId}`,
        headers: {
          "x-bb-api-key": override ? "override-key" : "test-key",
        },
      });
      expect(server.requests[0]!.bodyText).toBe("");
      expect(server.requests[0]!.jsonBody).toBeUndefined();
    },
  );

  it("escapes both IDs as individual path segments", async () => {
    server = await startFakeBrowserbaseServer((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    const result = await runCli(
      [
        "functions",
        "secrets",
        "detach",
        "id/with?query#fragment",
        "secret/with?query#fragment",
        "--base-url",
        server.baseUrl,
      ],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(server.requests[0]?.path).toBe(
      "/v1/functions/id%2Fwith%3Fquery%23fragment/secrets/secret%2Fwith%3Fquery%23fragment",
    );
  });

  it.each([400, 403, 404])(
    "reports HTTP %s without retrying",
    async (status) => {
      server = await startFakeBrowserbaseServer((_request, response) =>
        jsonResponse(response, status, { message: "Attachment rejected" }),
      );
      const result = await runCli(
        [
          "functions",
          "secrets",
          "detach",
          functionId,
          secretId,
          "--base-url",
          server.baseUrl,
        ],
        { env },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Attachment rejected");
      expect(server.requests).toHaveLength(1);
    },
  );

  it.each([{ ids: [] }, { ids: [functionId] }])(
    "requires both IDs: $ids",
    async ({ ids }) => {
      server = await startFakeBrowserbaseServer((_request, response) =>
        jsonResponse(response, 200, {}),
      );
      const result = await runCli(
        [
          "functions",
          "secrets",
          "detach",
          ...ids,
          "--base-url",
          server.baseUrl,
        ],
        { env },
      );
      expect(result.exitCode).not.toBe(0);
      expect(server.requests).toHaveLength(0);
    },
  );
});
