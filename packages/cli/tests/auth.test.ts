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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { credentialFetch, resolveCredential } from "../src/lib/auth/credentials.js";
import { login, loginProvider, readLoginJson } from "../src/lib/auth/login.js";
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
import { fakeKeyring } from "./helpers/keyring.js";
import { oauthProvider, otherProjectId } from "./helpers/oauth-provider.js";

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
  it("writes a private atomic record and removes it without revoking anything", () => {
    const env = environment();
    expect(readCredential(env)).toBeUndefined();
    writeCredential(fixture, env);
    expect(lstatSync(credentialPath(env)).mode & 0o777).toBe(0o600);
    expect(readCredential(env)).toEqual(fixture);
    expect(removeCredential(env)).toBe(true);
    expect(removeCredential(env)).toBe(false);
  });

  it("rejects broad permissions, linked credentials, and symlinked directories", () => {
    const env = environment();
    writeCredential(fixture, env);
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
    expect(() => writeCredential(fixture, env)).toThrow(/symlinked/);
    expect(existsSync(join(target, "credential.json"))).toBe(false);
  });

  it("keeps explicit flag and environment precedence, and binds saved keys to their API and project", () => {
    const env = environment();
    writeCredential({ ...fixture, apiOrigin: developmentApiOrigin }, env);
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

describe("OS credential storage", () => {
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

  it("uses the OAuth library with signed tokens, PKCE and a real loopback callback before fetching one key", async () => {
    const provider = await oauthProvider();
    try {
      const credential = await login({
        dashboard: provider.dashboard,
        development: true,
        openBrowser: async (value) => {
          const callback = provider.callbackFor(value);
          expect(new URL(value).pathname).toBe("/cli/authorize");
          expect(new URL(value).searchParams.has("code_verifier")).toBe(false);
          const state = callback.searchParams.get("state")!;
          callback.searchParams.set("state", "wrong-state");
          expect((await fetch(callback)).status).toBe(400);
          callback.searchParams.set("state", state);
          expect(
            (await fetch(callback, { headers: { origin: "https://evil.example" } })).status,
          ).toBe(403);
          const response = await fetch(callback);
          expect(response.status).toBe(200);
          expect(await response.text()).not.toContain(fixture.apiKey);
        },
      });
      expect(credential).toEqual({ ...fixture, apiOrigin: developmentApiOrigin });
      expect(provider.state).toMatchObject({
        pkceVerified: true,
        exchanges: 1,
        projects: 1,
        credentials: 1,
        revocations: 1,
      });
    } finally {
      await provider.close();
    }
  });

  it.each(["issuer", "audience", "nonce", "signature"] as const)(
    "rejects an ID token with invalid %s before requesting projects",
    async (invalidJwt) => {
      const provider = await oauthProvider({ invalidJwt });
      try {
        await expect(login({ ...provider, development: true })).rejects.toThrow(
          "Browser sign-in failed",
        );
        expect(provider.state.projects).toBe(0);
        expect(provider.state.credentials).toBe(0);
      } finally {
        await provider.close();
      }
    },
  );

  it("rejects issuer and scope configuration changes before opening a browser", async () => {
    const provider = await oauthProvider({ configScopes: ["openid", "email"] });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow(
        "invalid login configuration",
      );
      expect(provider.state.exchanges).toBe(0);
    } finally {
      await provider.close();
    }
  });

  it("checks discovery issuer consistency", async () => {
    const provider = await oauthProvider({ discoveryIssuer: "https://wrong.example" });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow(
        "Browser sign-in failed",
      );
      expect(provider.state.exchanges).toBe(0);
    } finally {
      await provider.close();
    }
  });

  it("fails a rejected PKCE exchange without obtaining a key", async () => {
    const provider = await oauthProvider();
    try {
      await expect(
        login({
          dashboard: provider.dashboard,
          development: true,
          openBrowser: async (value) => {
            const callback = provider.callbackFor(value);
            provider.state.authorize!.searchParams.set("code_challenge", "invalid-challenge");
            await fetch(callback);
          },
        }),
      ).rejects.toThrow("Browser sign-in failed");
      expect(provider.state.pkceVerified).toBe(false);
      expect(provider.state.credentials).toBe(0);
    } finally {
      await provider.close();
    }
  });

  it("requires project-key scope and revokes the temporary refresh grant on failure", async () => {
    const provider = await oauthProvider({ tokenScopes: "openid" });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow(
        "required project-key access",
      );
      expect(provider.state.projects).toBe(0);
      expect(provider.state.revocations).toBe(1);
    } finally {
      await provider.close();
    }
  });

  it("selects one permitted project while keeping the saved credential format unchanged", async () => {
    const provider = await oauthProvider({ manyProjects: true });
    try {
      const credential = await login({
        ...provider,
        development: true,
        chooseProject: async () => otherProjectId,
      });
      expect(credential.projectId).toBe(otherProjectId);
      expect(provider.state.credentials).toBe(1);
      expect(provider.state.revocations).toBe(1);
    } finally {
      await provider.close();
    }
  });

  it("accepts an explicit project only when it is permitted by the login", async () => {
    const provider = await oauthProvider({ manyProjects: true });
    try {
      const credential = await login({ ...provider, development: true, projectId: otherProjectId });
      expect(credential.projectId).toBe(otherProjectId);
      await expect(
        login({ ...provider, development: true, projectId: "not-permitted" }),
      ).rejects.toThrow("not available");
      expect(provider.state.credentials).toBe(1);
      expect(provider.state.revocations).toBe(2);
    } finally {
      await provider.close();
    }
  });

  it("requires an interactive project chooser and clears temporary authorization", async () => {
    const provider = await oauthProvider({ manyProjects: true });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow(
        "interactive terminal",
      );
      expect(provider.state.credentials).toBe(0);
      expect(provider.state.revocations).toBe(1);
    } finally {
      await provider.close();
    }
  });

  it("revokes temporary authorization when selection is canceled", async () => {
    const provider = await oauthProvider({ manyProjects: true });
    const controller = new AbortController();
    try {
      await expect(
        login({
          ...provider,
          development: true,
          signal: controller.signal,
          chooseProject: async () => {
            controller.abort();
            throw new Error("Canceled");
          },
        }),
      ).rejects.toThrow("canceled");
      expect(provider.state.credentials).toBe(0);
      expect(provider.state.revocations).toBe(1);
    } finally {
      await provider.close();
    }
  });

  it("cancels a completed login during cleanup without skipping refresh revocation", async () => {
    const controller = new AbortController();
    const provider = await oauthProvider({ onRevoke: () => controller.abort() });
    try {
      await expect(
        login({ ...provider, development: true, signal: controller.signal }),
      ).rejects.toThrow("canceled");
      expect(provider.state.credentials).toBe(1);
      expect(provider.state.revocations).toBe(1);
    } finally {
      await provider.close();
    }
  });

  it("rejects a credential for another project and still clears the temporary grant", async () => {
    const provider = await oauthProvider({ wrongCredentialProject: true });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow("different project");
      expect(provider.state.revocations).toBe(1);
    } finally {
      await provider.close();
    }
  });

  it("does not save a key when temporary-grant cleanup fails", async () => {
    const provider = await oauthProvider({ rejectRevocation: true });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow("Could not clear");
    } finally {
      await provider.close();
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

  it("handles denial, cancellation and expiry without obtaining a key", async () => {
    const provider = await oauthProvider();
    try {
      await expect(
        login({
          dashboard: provider.dashboard,
          development: true,
          timeoutMs: 20,
          openBrowser: async () => {},
        }),
      ).rejects.toThrow("expired");
      const controller = new AbortController();
      await expect(
        login({
          dashboard: provider.dashboard,
          development: true,
          signal: controller.signal,
          openBrowser: async () => controller.abort(),
        }),
      ).rejects.toThrow("canceled");
      await expect(
        login({
          dashboard: provider.dashboard,
          development: true,
          openBrowser: async (value) => {
            const callback = provider.callbackFor(value);
            callback.searchParams.delete("code");
            callback.searchParams.set("error", "access_denied");
            await fetch(callback);
          },
        }),
      ).rejects.toThrow("denied");
      expect(provider.state.credentials).toBe(0);
    } finally {
      await provider.close();
    }
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
