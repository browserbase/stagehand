import { toFile } from "@browserbasehq/sdk";
import { createBrowserbaseClient } from "../src/lib/cloud/api.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { credentialFetch, resolveCredential } from "../src/lib/auth/credentials.js";
import { challengeFor, login, loginProvider, readLoginJson } from "../src/lib/auth/login.js";
import {
  credentialPath,
  developmentApiOrigin,
  productionApiOrigin,
  readCredential,
  requireSupportedCredentialStore,
  savedCredentialStore,
  removeCredential,
  writeCredential,
} from "../src/lib/auth/store.js";
import { runCli } from "./helpers/run-cli.js";

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
  it("writes a private atomic record and removes it without revoking anything", () => {
    const env = environment();
    expect(readCredential(env)).toBeUndefined();
    writeCredential(fixture, env, "file");
    expect(lstatSync(credentialPath(env)).mode & 0o777).toBe(0o600);
    expect(readCredential(env)).toEqual(fixture);
    expect(removeCredential(env)).toBe(true);
    expect(removeCredential(env)).toBe(false);
  });

  it("rejects broad permissions, linked credentials, and symlinked directories", () => {
    const env = environment();
    writeCredential(fixture, env, "file");
    const path = credentialPath(env);
    chmodSync(path, 0o644);
    expect(() => readCredential(env)).toThrow("securely read");
    chmodSync(path, 0o600);
    linkSync(path, join(env.BROWSERBASE_CONFIG_DIR, "second-link"));
    expect(() => readCredential(env)).toThrow("securely read");
    rmSync(join(env.BROWSERBASE_CONFIG_DIR, "second-link"));
    rmSync(path);
    symlinkSync(join(env.BROWSERBASE_CONFIG_DIR, "second-link"), path);
    expect(() => readCredential(env)).toThrow("securely read");
    rmSync(path);
    rmSync(join(env.BROWSERBASE_CONFIG_DIR, "auth"), { recursive: true });
    const target = join(env.BROWSERBASE_CONFIG_DIR, "target");
    mkdirSync(target, { mode: 0o700 });
    symlinkSync(target, join(env.BROWSERBASE_CONFIG_DIR, "auth"));
    expect(() => writeCredential(fixture, env, "file")).toThrow(/symlinked/);
    expect(existsSync(join(target, "credential.json"))).toBe(false);
  });

  it("keeps explicit flag and environment precedence, and binds saved keys to their API and project", () => {
    const env = environment();
    writeCredential({ ...fixture, apiOrigin: developmentApiOrigin }, env, "file");
    expect(resolveCredential({}, env)).toMatchObject({
      source: "saved",
      baseUrl: developmentApiOrigin,
    });
    expect(() => resolveCredential({ baseUrl: productionApiOrigin }, env)).toThrow(
      "different API URL",
    );
    expect(() => resolveCredential({ baseUrl: "https://example.com" }, env)).toThrow(
      "different API URL",
    );
    expect(() =>
      resolveCredential({}, { ...env, BROWSERBASE_PROJECT_ID: "another-project" }),
    ).toThrow("differs");
    expect(() => resolveCredential({}, { ...env, DEBUG: "true" })).toThrow("Unset DEBUG");
    expect(
      resolveCredential(
        { apiKey: "flag-key", baseUrl: "https://example.com" },
        { ...env, BROWSERBASE_API_KEY: "env-key" },
      ),
    ).toMatchObject({ source: "flag", apiKey: "flag-key", baseUrl: "https://example.com" });
    expect(resolveCredential({}, { ...env, BROWSERBASE_API_KEY: "env-key" })).toMatchObject({
      source: "environment",
      apiKey: "env-key",
      baseUrl: productionApiOrigin,
    });
    expect(resolveCredential({ apiKey: "" }, env)).toBeUndefined();
  });

  it("blocks destination changes and redirects and never prints reflected saved keys", async () => {
    const credential = { ...fixture, baseUrl: fixture.apiOrigin, source: "saved" as const };
    const request = vi
      .fn()
      .mockResolvedValue(new Response(`error contains ${fixture.apiKey}`, { status: 401 }));
    vi.stubGlobal("fetch", request);
    const guarded = credentialFetch(credential);
    await expect(guarded("https://example.com/leak")).rejects.toThrow("different destination");
    expect(request).not.toHaveBeenCalled();
    const response = await guarded(`${productionApiOrigin}/v1/projects`);
    expect(request).toHaveBeenCalledWith(`${productionApiOrigin}/v1/projects`, {
      redirect: "error",
    });
    expect(await response.text()).not.toContain(fixture.apiKey);
  });

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

describe("OS credential storage", () => {
  function fakeKeyring() {
    const require = createRequire(import.meta.url);
    const library = require("@napi-rs/keyring");
    const secrets = new Map<string, string>();
    const state = { unavailable: false, rejectDelete: false, failNextDelete: false };
    const constructor = vi.spyOn(library, "Entry").mockImplementation(function (
      service: string,
      account: string,
      options: unknown,
    ) {
      expect(service).toBe("com.browserbase.browse");
      expect(options).toEqual({ linux: { store: "secret-service" } });
      if (state.unavailable) throw new Error("unavailable");
      return {
        getPassword: () => secrets.get(account) ?? null,
        setPassword: (value: string) => {
          secrets.set(account, value);
        },
        deleteCredential: () => {
          if (state.rejectDelete) throw new Error("locked");
          if (state.failNextDelete) {
            state.failNextDelete = false;
            throw new Error("locked once");
          }
          return secrets.delete(account);
        },
      };
    });
    return { secrets, state, constructor };
  }

  it("stores the key only in the OS store by default, isolates config namespaces, and deletes on logout", () => {
    const backend = fakeKeyring();
    const env = environment();
    expect(readCredential(env)).toBeUndefined();
    expect(backend.constructor).not.toHaveBeenCalled();
    writeCredential(fixture, env);
    expect(savedCredentialStore(env)).toBe("keychain");
    expect(readFileSync(credentialPath(env), "utf8")).not.toContain(fixture.apiKey);
    expect(readCredential(env)).toEqual(fixture);
    const other = environment();
    writeCredential({ ...fixture, apiKey: "other-synthetic-key" }, other);
    expect(backend.secrets.size).toBe(2);
    expect(readCredential(env)?.apiKey).toBe(fixture.apiKey);
    expect(removeCredential(env)).toBe(true);
    expect(backend.secrets.size).toBe(1);
    expect(readCredential(other)?.apiKey).toBe("other-synthetic-key");
  });

  it("fails closed without silently writing plaintext when the native store is unavailable", () => {
    const backend = fakeKeyring();
    backend.state.unavailable = true;
    const env = environment();
    expect(() => requireSupportedCredentialStore()).toThrow("No plaintext fallback");
    expect(() => writeCredential(fixture, env)).toThrow("No plaintext fallback");
    expect(existsSync(credentialPath(env))).toBe(false);
    expect(backend.secrets.size).toBe(0);
  });

  it("leaves metadata intact when OS deletion fails, so logout can be retried", () => {
    const backend = fakeKeyring();
    const env = environment();
    writeCredential(fixture, env);
    backend.state.rejectDelete = true;
    expect(() => removeCredential(env)).toThrow("No plaintext fallback");
    expect(readCredential(env)).toEqual(fixture);
    backend.state.rejectDelete = false;
    expect(removeCredential(env)).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "cleans up prior OS entries when explicitly switching to file storage",
    () => {
      const backend = fakeKeyring();
      const env = environment();
      writeCredential(fixture, env);
      writeCredential(fixture, env, "file");
      expect(backend.secrets.size).toBe(0);
      expect(savedCredentialStore(env)).toBe("file");
      expect(readCredential(env)).toEqual(fixture);
    },
  );
  it("restores the previous login and removes the new OS entry if replacement cleanup fails", () => {
    const backend = fakeKeyring();
    const env = environment();
    writeCredential(fixture, env);
    backend.state.failNextDelete = true;
    expect(() => writeCredential({ ...fixture, apiKey: "replacement-synthetic-key" }, env)).toThrow(
      "Could not update saved login",
    );
    expect(readCredential(env)).toEqual(fixture);
    expect(backend.secrets.size).toBe(1);
    expect(readFileSync(credentialPath(env), "utf8")).not.toContain(fixture.apiKey);
  });
});

describe("browser authorization", () => {
  it("uses a fixed production provider and requires explicit development mode for local providers", () => {
    expect(loginProvider()).toEqual({
      origin: "https://www.browserbase.com",
      apiOrigin: productionApiOrigin,
    });
    expect(() => loginProvider("http://127.0.0.1:3000")).toThrow();
    expect(() => loginProvider("https://example.com", true)).toThrow();
    expect(() => loginProvider("https://www.browserbase.com@evil.example")).toThrow();
    expect(() => loginProvider("https://www.browserbase.com/path")).toThrow();
    expect(loginProvider("http://127.0.0.1:3000", true).apiOrigin).toBe(developmentApiOrigin);
  });

  it("uses real loopback requests, ignores wrong state/origin, and binds code exchange to PKCE and redirect", async () => {
    const code = "a".repeat(43);
    let authorize: URL;
    let exchanged = false;
    const server = createServer(async (req, res) => {
      expect(req.url).toBe("/cli/token");
      let body = "";
      for await (const part of req) body += part;
      const data = JSON.parse(body);
      expect(data).toMatchObject({
        code,
        client_id: "browserbase-cli",
        grant_type: "authorization_code",
        redirect_uri: authorize.searchParams.get("redirect_uri"),
      });
      expect(challengeFor(data.code_verifier)).toBe(authorize.searchParams.get("code_challenge"));
      expect(authorize.searchParams.has("code_verifier")).toBe(false);
      exchanged = true;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ...fixture, apiOrigin: developmentApiOrigin }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const credential = await login({
        dashboard: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        development: true,
        openBrowser: async (value) => {
          authorize = new URL(value);
          const callback = new URL(authorize.searchParams.get("redirect_uri")!);
          callback.search = new URLSearchParams({ code, state: "wrong-state" }).toString();
          expect((await fetch(callback)).status).toBe(400);
          callback.searchParams.set("state", authorize.searchParams.get("state")!);
          expect(
            (await fetch(callback, { headers: { origin: "https://evil.example" } })).status,
          ).toBe(403);
          const response = await fetch(callback);
          expect(response.status).toBe(200);
          expect(await response.text()).not.toContain(fixture.apiKey);
        },
      });
      expect(exchanged).toBe(true);
      expect(credential).toEqual({ ...fixture, apiOrigin: developmentApiOrigin });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("bounds login responses and sanitizes malformed JSON", async () => {
    await expect(readLoginJson(new Response(`not-json ${fixture.apiKey}`))).rejects.toThrow(
      "Invalid credential response",
    );
    await expect(readLoginJson(new Response("x".repeat(32769)))).rejects.toThrow(
      "Invalid credential response",
    );
  });

  it("handles cancellation and times out without accepting or storing a key", async () => {
    await expect(login({ timeoutMs: 20, openBrowser: async () => {} })).rejects.toThrow("expired");
    const controller = new AbortController();
    await expect(
      login({ signal: controller.signal, openBrowser: async () => controller.abort() }),
    ).rejects.toThrow("canceled");
    await expect(
      login({
        openBrowser: async (value) => {
          const url = new URL(value);
          const callback = new URL(url.searchParams.get("redirect_uri")!);
          callback.search = new URLSearchParams({
            state: url.searchParams.get("state")!,
            error: "access_denied",
          }).toString();
          await fetch(callback);
        },
      }),
    ).rejects.toThrow("denied");
  });
});

describe("authenticated SDK transport", () => {
  it("preserves multipart uploads through the native fetch redirect guard", async () => {
    let received = false;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      expect(request.headers["x-bb-api-key"]).toBe("synthetic-test-key");
      expect(request.headers["content-type"]).toMatch(/multipart\/form-data; boundary=/);
      expect(Buffer.concat(chunks).toString()).toContain("synthetic-extension-archive");
      received = true;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id: "test-extension" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const client = createBrowserbaseClient({
        apiKey: "synthetic-test-key",
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      });
      const extension = await client.extensions.create({
        file: await toFile(Buffer.from("synthetic-extension-archive"), "example.zip"),
      });
      expect(extension.id).toBe("test-extension");
      expect(received).toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
