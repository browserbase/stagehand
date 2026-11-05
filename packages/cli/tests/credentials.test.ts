import Browserbase, { toFile } from "@browserbasehq/sdk";
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
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  credentialFetch,
  resolveCredential,
  sdkCredentialFetch,
} from "../src/lib/auth/credentials.js";
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
import { fakeKeyring } from "./helpers/keyring.js";
import * as metadata from "../src/lib/auth/file-store.js";

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
});

describe("OS credential storage", () => {
  it("treats empty config environment variables as unset", () => {
    expect(credentialPath({ BROWSERBASE_CONFIG_DIR: "", XDG_CONFIG_HOME: "" })).toBe(
      credentialPath({}),
    );
  });

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

  it("replaces the saved login in the same OS entry without rewriting its reference", () => {
    const backend = fakeKeyring();
    const env = environment();
    writeCredential(fixture, env);
    const originalReference = readFileSync(credentialPath(env), "utf8");
    const writeReference = vi.spyOn(metadata, "writePrivateRecord");
    backend.state.rejectDelete = true;
    const replacement = { ...fixture, apiKey: "replacement-synthetic-key" };
    writeCredential(replacement, env);
    expect(readCredential(env)).toEqual(replacement);
    expect(backend.secrets.size).toBe(1);
    expect(readFileSync(credentialPath(env), "utf8")).toBe(originalReference);
    expect(writeReference).not.toHaveBeenCalled();
  });

  it("does not delete the existing OS entry when a replacement write fails", () => {
    const backend = fakeKeyring();
    const env = environment();
    writeCredential(fixture, env);
    const originalReference = readFileSync(credentialPath(env), "utf8");
    backend.state.rejectWrite = true;
    expect(() => writeCredential({ ...fixture, apiKey: "replacement-synthetic-key" }, env)).toThrow(
      "No plaintext fallback",
    );
    expect(readCredential(env)).toEqual(fixture);
    expect(backend.secrets.size).toBe(1);
    expect(readFileSync(credentialPath(env), "utf8")).toBe(originalReference);
    backend.state.rejectWrite = false;
    writeCredential({ ...fixture, apiKey: "retry-synthetic-key" }, env);
    expect(readCredential(env)?.apiKey).toBe("retry-synthetic-key");
  });

  it("removes a new OS entry if its first reference cannot be saved", () => {
    const backend = fakeKeyring();
    const env = environment();
    vi.spyOn(metadata, "writePrivateRecord").mockImplementation(() => {
      throw new Error("disk full");
    });
    expect(() => writeCredential(fixture, env)).toThrow("Could not update saved login");
    expect(backend.secrets.size).toBe(0);
    expect(existsSync(credentialPath(env))).toBe(false);
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
      const credential = {
        apiKey: "synthetic-test-key",
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        source: "saved" as const,
      };
      const client = new Browserbase({
        apiKey: credential.apiKey,
        baseURL: credential.baseUrl,
        fetch: sdkCredentialFetch(credential),
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
