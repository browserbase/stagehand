import { Aes256Gcm, CipherSuite, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";
import { afterEach, describe, expect, it } from "vitest";
import {
  jsonResponse,
  startFakeBrowserbaseServer,
  type FakeBrowserbaseServer,
} from "./helpers/fake-browserbase-server.js";
import { runCli } from "./helpers/run-cli.js";

const secretId = "d2c4f48f-38e9-4b82-a36a-2b373fd14a65";
const functionId = "ab76f718-0c41-4130-8b02-c926721801fc";
const metadata = { id: secretId, secretKey: "SERVICE_TOKEN" };
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

function suite() {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
}

async function keypair() {
  const crypto = suite();
  const pair = await crypto.kem.generateKeyPair();
  const publicKey = Buffer.from(
    await crypto.kem.serializePublicKey(pair.publicKey),
  ).toString("base64");
  return { crypto, pair, publicKey };
}

describe("secret CLI HTTP contracts", () => {
  it.each(["create", "update"])(
    "%s fetches the public key and encrypts exact stdin bytes",
    async (command) => {
      const { crypto, pair, publicKey } = await keypair();
      const value = "  token-🔑\nwith-whitespace\r\n";
      server = await startFakeBrowserbaseServer((request, response) => {
        if (request.path === "/v1/secrets/keypair")
          jsonResponse(response, 200, { id: "keypair-1", publicKey });
        else jsonResponse(response, command === "create" ? 201 : 200, metadata);
      });
      const result = await runCli(
        [
          "cloud",
          "secrets",
          command,
          command === "create" ? "SERVICE_TOKEN" : secretId,
          "--stdin",
          "--base-url",
          server.baseUrl,
        ],
        { env, stdin: value },
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(metadata);
      expect(server.requests.map((r) => [r.method, r.path])).toEqual([
        ["GET", "/v1/secrets/keypair"],
        [
          command === "create" ? "POST" : "PATCH",
          command === "create" ? "/v1/secrets" : `/v1/secrets/${secretId}`,
        ],
      ]);
      for (const request of server.requests)
        expect(request.headers["x-bb-api-key"]).toBe("test-key");
      const body = server.requests[1]!.jsonBody as {
        keypairId: string;
        sealedSecretValue: string;
        secretKey?: string;
      };
      expect(body.keypairId).toBe("keypair-1");
      expect(Object.keys(body).sort()).toEqual(
        (command === "create"
          ? ["secretKey", "sealedSecretValue", "keypairId"]
          : ["sealedSecretValue", "keypairId"]
        ).sort(),
      );
      if (command === "create") expect(body.secretKey).toBe("SERVICE_TOKEN");
      expect(server.requests[1]!.headers["content-type"]).toBe(
        "application/json",
      );
      const blob = Buffer.from(body.sealedSecretValue, "base64");
      const recipient = await crypto.createRecipientContext({
        recipientKey: pair.privateKey,
        enc: new Uint8Array(blob.subarray(0, 32)).buffer,
      });
      expect(
        Buffer.from(
          await recipient.open(new Uint8Array(blob.subarray(32)).buffer),
        ).toString("utf8"),
      ).toBe(value);
      expect(server.requests[1]!.bodyText).not.toContain("token-🔑");
      expect(result.stdout + result.stderr).not.toContain("token-🔑");
    },
  );

  it.each(["create", "update"])(
    "%s stops if key retrieval fails",
    async (command) => {
      server = await startFakeBrowserbaseServer((_request, response) =>
        jsonResponse(response, 403, { message: "Forbidden" }),
      );
      const result = await runCli(
        [
          "cloud",
          "secrets",
          command,
          command === "create" ? "TOKEN" : secretId,
          "--stdin",
          "--base-url",
          server.baseUrl,
        ],
        { env, stdin: "private-value" },
      );
      expect(result.exitCode).not.toBe(0);
      expect(server.requests).toHaveLength(1);
      expect(result.stderr).toContain("Forbidden");
      expect(result.stdout + result.stderr).not.toContain("private-value");
    },
  );

  it("rejects a malformed public key without submitting a secret", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, { id: "keypair-1", publicKey: "bad" }),
    );
    const result = await runCli(
      [
        "cloud",
        "secrets",
        "create",
        "TOKEN",
        "--stdin",
        "--base-url",
        server.baseUrl,
      ],
      { env, stdin: "private-value" },
    );
    expect(result.exitCode).not.toBe(0);
    expect(server.requests).toHaveLength(1);
    expect(result.stderr).toContain("invalid X25519 public key");
  });

  it.each([
    {
      args: ["cloud", "secrets", "get", secretId],
      path: `/v1/secrets/${secretId}`,
      body: metadata,
    },
    {
      args: ["cloud", "secrets", "keypair"],
      path: "/v1/secrets/keypair",
      body: { id: "keypair-1", publicKey: "public-key" },
    },
  ])("returns metadata for $path", async ({ args, path, body }) => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, body),
    );
    const result = await runCli([...args, "--base-url", server.baseUrl], {
      env,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(body);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      method: "GET",
      path,
      headers: { "x-bb-api-key": "test-key" },
    });
  });

  it.each([
    { args: ["cloud", "secrets", "list"], path: "/v1/secrets" },
    {
      args: ["functions", "secrets", "list", functionId],
      path: `/v1/functions/${functionId}/secrets`,
    },
  ])("preserves pagination and filters for $path", async ({ args, path }) => {
    const page = { data: [metadata], limit: 2, nextCursor: "next+/=" };
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, page),
    );
    const result = await runCli(
      [
        ...args,
        "--limit",
        "2",
        "--cursor",
        "opaque+/=",
        "--start-at",
        "2026-01-01T00:00:00Z",
        "--end-at",
        "2026-02-01T00:00:00Z",
        "--base-url",
        server.baseUrl,
      ],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(page);
    expect(server.requests).toHaveLength(1);
    const url = new URL(server.requests[0]!.path, server.baseUrl);
    expect(url.pathname).toBe(path);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: "2",
      cursor: "opaque+/=",
      startAt: "2026-01-01T00:00:00Z",
      endAt: "2026-02-01T00:00:00Z",
    });
    expect(server.requests[0]!.headers["x-bb-api-key"]).toBe("test-key");
  });

  it.each([
    {
      args: ["cloud", "secrets", "delete", secretId],
      method: "DELETE",
      path: `/v1/secrets/${secretId}`,
      body: undefined,
    },
    {
      args: ["functions", "secrets", "attach", functionId, secretId],
      method: "POST",
      path: `/v1/functions/${functionId}/secrets`,
      body: { secretId },
    },
    {
      args: ["functions", "secrets", "detach", functionId, secretId],
      method: "DELETE",
      path: `/v1/functions/${functionId}/secrets/${secretId}`,
      body: undefined,
    },
  ])("handles 204 for $args", async ({ args, method, path, body }) => {
    server = await startFakeBrowserbaseServer((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    const result = await runCli([...args, "--base-url", server.baseUrl], {
      env,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe("");
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      method,
      path,
      headers: { "x-bb-api-key": "test-key" },
    });
    expect(server.requests[0]!.jsonBody).toEqual(body);
  });

  it.each([400, 401, 403, 404, 409, 500])(
    "propagates HTTP %i as a nonzero exit",
    async (status) => {
      server = await startFakeBrowserbaseServer((_request, response) =>
        jsonResponse(response, status, {
          message: `Request rejected ${status}`,
        }),
      );
      const result = await runCli(
        [
          "functions",
          "secrets",
          "attach",
          functionId,
          secretId,
          "--base-url",
          server.baseUrl,
        ],
        { env },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(`Request rejected ${status}`);
      expect(result.stdout).toBe("");
    },
  );

  it("returns an empty final page without inventing query parameters", async () => {
    const page = { data: [], limit: 20, nextCursor: null };
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, page),
    );
    const result = await runCli(
      ["cloud", "secrets", "list", "--base-url", server.baseUrl],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(page);
    expect(server.requests[0]!.path).toBe("/v1/secrets");
  });

  it("fails without an API key before sending a request", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, {}),
    );
    const result = await runCli(
      ["cloud", "secrets", "list", "--base-url", server.baseUrl],
      { env: { ...env, BROWSERBASE_API_KEY: "" } },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Missing Browserbase API key");
    expect(server.requests).toHaveLength(0);
  });

  it("requires --stdin for noninteractive values", async () => {
    const result = await runCli(["cloud", "secrets", "create", "TOKEN"], {
      env,
      stdin: "private-value",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Use --stdin");
    expect(result.stdout + result.stderr).not.toContain("private-value");
  });

  it.each(["0", "1001"])(
    "rejects out-of-range limit %s before sending a request",
    async (limit) => {
      server = await startFakeBrowserbaseServer((_request, response) =>
        jsonResponse(response, 200, {}),
      );
      const result = await runCli(
        [
          "cloud",
          "secrets",
          "list",
          "--limit",
          limit,
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
