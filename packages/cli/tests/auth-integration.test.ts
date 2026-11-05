import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { productionApiOrigin, readCredential, writeCredential } from "../src/lib/auth/store.js";
import { createBrowserbaseClient, requestBrowserbase } from "../src/lib/cloud/api.js";
import { functionsRequest, resolveFunctionsApiConfig } from "../src/lib/functions/shared.js";
import { runCli } from "./helpers/run-cli.js";
import { fakeKeyring } from "./helpers/keyring.js";

const directories: string[] = [];
const fixture = {
  apiKey: "synthetic-test-key",
  projectId: "00000000-0000-4000-8000-000000000001",
  apiOrigin: productionApiOrigin,
};
function environment() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "browse-auth-test-")));
  directories.push(directory);
  return { BROWSERBASE_CONFIG_DIR: directory };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("saved login", () => {
  beforeEach(() => {
    fakeKeyring();
  });
  it("resolves a persisted login in a fresh CLI process and logout leaves env credentials active", async () => {
    const env = environment();
    writeCredential(fixture, env);
    const transport = join(env.BROWSERBASE_CONFIG_DIR, "transport.mjs");
    writeFileSync(
      transport,
      `
      import { createRequire } from 'node:module';
      const require = createRequire(${JSON.stringify(new URL("../src/lib/auth/store.ts", import.meta.url).href)});
      require('@napi-rs/keyring').Entry = class {
        getPassword() { return ${JSON.stringify(JSON.stringify(fixture))}; }
        deleteCredential() { return true; }
      };
      globalThis.fetch = async (input, init) => {
        if (String(input) !== 'https://api.browserbase.com/v1/projects' ||
          new Headers(init.headers).get('x-bb-api-key') !== 'synthetic-test-key' ||
          init.redirect !== 'error') throw new Error('Unexpected request');
        return new Response(JSON.stringify([{ id: '00000000-0000-4000-8000-000000000001', name: 'Example' }]), { headers: { 'content-type': 'application/json' } });
      };
    `,
    );
    const childEnv = {
      ...env,
      BROWSERBASE_API_KEY: undefined,
      BROWSERBASE_BASE_URL: undefined,
      BROWSERBASE_PROJECT_ID: undefined,
      DEBUG: undefined,
      DO_NOT_TRACK: "1",
      NODE_OPTIONS: `--import=${transport}`,
    };
    const result = await runCli(["cloud", "projects", "list", "--json"], { env: childEnv });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)[0].id).toBe(fixture.projectId);
    expect(result.stdout + result.stderr).not.toContain(fixture.apiKey);
    const status = await runCli(["auth", "status"], { env: childEnv });
    expect(status.exitCode, status.stderr).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      source: "saved",
      savedLogin: true,
      verified: false,
    });
    expect(status.stdout).not.toContain(fixture.apiKey);
    const logout = await runCli(["logout"], {
      env: { ...childEnv, BROWSERBASE_API_KEY: "explicit-env-key" },
    });
    expect(logout.exitCode, logout.stderr).toBe(0);
    expect(logout.stdout).toContain("BROWSERBASE_API_KEY is still set");
    expect(readCredential(env)).toBeUndefined();
  });
});

describe.skipIf(process.platform === "win32")("plaintext credential storage", () => {
  it("resolves a persisted login in a fresh CLI process and logout leaves env credentials active", async () => {
    const env = environment();
    writeCredential(fixture, env, "file");
    const transport = join(env.BROWSERBASE_CONFIG_DIR, "transport.mjs");
    writeFileSync(
      transport,
      `
      globalThis.fetch = async (input, init) => {
        if (String(input) !== 'https://api.browserbase.com/v1/projects' ||
          new Headers(init.headers).get('x-bb-api-key') !== 'synthetic-test-key' ||
          init.redirect !== 'error') throw new Error('Unexpected request');
        return new Response(JSON.stringify([{ id: '00000000-0000-4000-8000-000000000001', name: 'Example' }]), { headers: { 'content-type': 'application/json' } });
      };
    `,
    );
    const childEnv = {
      ...env,
      BROWSERBASE_API_KEY: undefined,
      BROWSERBASE_BASE_URL: undefined,
      BROWSERBASE_PROJECT_ID: undefined,
      DEBUG: undefined,
      DO_NOT_TRACK: "1",
      NODE_OPTIONS: `--import=${transport}`,
    };
    const result = await runCli(["cloud", "projects", "list", "--json"], { env: childEnv });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)[0].id).toBe(fixture.projectId);
    expect(result.stdout + result.stderr).not.toContain(fixture.apiKey);
    const status = await runCli(["auth", "status"], { env: childEnv });
    expect(status.exitCode, status.stderr).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      source: "saved",
      savedLogin: true,
      storage: "plaintext-file",
      verified: false,
    });
    expect(status.stdout).not.toContain(fixture.apiKey);
    const logout = await runCli(["logout"], {
      env: { ...childEnv, BROWSERBASE_API_KEY: "explicit-env-key" },
    });
    expect(logout.exitCode, logout.stderr).toBe(0);
    expect(logout.stdout).toContain("BROWSERBASE_API_KEY is still set");
    expect(readCredential(env)).toBeUndefined();
  });
});

describe("explicit API keys retain their existing transports", () => {
  it.each(["flag", "environment"])(
    "keeps the SDK transport and redirects for %s keys",
    async (source) => {
      const server = createServer((request, response) => {
        if (request.url === "/v1/projects") {
          response.writeHead(302, { location: "/projects-result" }).end();
        } else {
          response.writeHead(200, { "content-type": "application/json" }).end("[]");
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        // The SDK's original Node transport does not use globalThis.fetch.
        const nativeFetch = vi.fn().mockRejectedValue(new Error("Unexpected native fetch"));
        vi.stubGlobal("fetch", nativeFetch);
        vi.stubEnv("BROWSERBASE_API_KEY", "synthetic-explicit-key");
        const client = createBrowserbaseClient({
          ...(source === "flag" ? { apiKey: "synthetic-explicit-key" } : {}),
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        });
        expect(await client.projects.list()).toEqual([]);
        expect(nativeFetch).not.toHaveBeenCalled();
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it("keeps cloud and Functions fetch options and error messages for explicit keys", async () => {
    const request = vi
      .fn()
      .mockImplementation(async () => new Response("original server error", { status: 400 }));
    vi.stubGlobal("fetch", request);
    const args = { apiKey: "synthetic-explicit-key" };
    await expect(requestBrowserbase(args, "/v1/projects")).rejects.toThrow("original server error");
    await expect(
      functionsRequest(resolveFunctionsApiConfig(args), "/v1/functions"),
    ).rejects.toThrow("original server error");
    for (const call of request.mock.calls) expect(call[1]).not.toHaveProperty("redirect");
  });
});
