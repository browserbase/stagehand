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

describe("secret update CLI HTTP contracts", () => {
  it.each(["stdin", "env"])(
    "fetches the public key and encrypts exact %s bytes",
    async (source) => {
      const { crypto, pair, publicKey } = await keypair();
      const value = "  token-🔑\nwith-whitespace\r\n";
      server = await startFakeBrowserbaseServer((request, response) => {
        if (request.path === "/v1/secrets/keypair")
          jsonResponse(response, 200, { id: "keypair-1", publicKey });
        else jsonResponse(response, 200, metadata);
      });
      const result = await runCli(
        [
          "cloud",
          "secrets",
          "update",
          secretId,
          ...(source === "stdin"
            ? ["--stdin"]
            : ["--env", "BROWSE_TEST_SECRET_VALUE"]),
          "--base-url",
          server.baseUrl,
        ],
        source === "stdin"
          ? { env, stdin: value }
          : { env: { ...env, BROWSE_TEST_SECRET_VALUE: value } },
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(metadata);
      expect(server.requests.map((r) => [r.method, r.path])).toEqual([
        ["GET", "/v1/secrets/keypair"],
        ["PATCH", `/v1/secrets/${secretId}`],
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
        ["sealedSecretValue", "keypairId"].sort(),
      );
      expect(body.secretKey).toBeUndefined();
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

  it("stops if key retrieval fails", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 403, { message: "Forbidden" }),
    );
    const result = await runCli(
      [
        "cloud",
        "secrets",
        "update",
        "TOKEN",
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
  });

  it("rejects a malformed public key without submitting a secret", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, { id: "keypair-1", publicKey: "bad" }),
    );
    const result = await runCli(
      [
        "cloud",
        "secrets",
        "update",
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

  it("requires --stdin for noninteractive input", async () => {
    const result = await runCli(["cloud", "secrets", "update", "TOKEN"], {
      env,
      stdin: "private-value",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Use --stdin");
    expect(result.stdout + result.stderr).not.toContain("private-value");
  });

  it("reports a missing secret without retrying the update", async () => {
    const { publicKey } = await keypair();
    server = await startFakeBrowserbaseServer((request, response) => {
      if (request.path === "/v1/secrets/keypair") {
        jsonResponse(response, 200, { id: "keypair-1", publicKey });
      } else {
        jsonResponse(response, 404, { message: "Secret not found" });
      }
    });
    const result = await runCli(
      [
        "cloud",
        "secrets",
        "update",
        "TOKEN",
        "--stdin",
        "--base-url",
        server.baseUrl,
      ],
      { env, stdin: "private-value" },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Secret not found");
    expect(server.requests).toHaveLength(2);
    expect(result.stdout + result.stderr).not.toContain("private-value");
  });
});

describe("environment secret input validation", () => {
  it.each([
    ["--env", "BROWSE_TEST_MISSING_SECRET_VALUE"],
    ["--env", ""],
    ["--env", "BROWSE_TEST_SECRET_VALUE", "--stdin"],
  ])("rejects invalid input flags %j before requesting", async (...flags) => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, {}),
    );
    const result = await runCli(
      [
        "cloud",
        "secrets",
        "update",
        "TOKEN",
        "--base-url",
        server.baseUrl,
        ...flags,
      ],
      {
        env: {
          ...env,
          BROWSE_TEST_MISSING_SECRET_VALUE: undefined,
          BROWSE_TEST_SECRET_VALUE: "private-value",
        },
      },
    );
    expect(result.exitCode).not.toBe(0);
    expect(server.requests).toHaveLength(0);
    expect(result.stdout + result.stderr).not.toContain("private-value");
  });
});
