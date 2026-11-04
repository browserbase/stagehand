import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  credentialPath,
  productionApiOrigin,
  readCredential,
  removeCredential,
  savedCredentialStore,
  writeCredential,
} from "../src/lib/auth/store.js";
import * as metadata from "../src/lib/auth/file-store.js";
import { fakeKeyring } from "./helpers/keyring.js";
import { runCli } from "./helpers/run-cli.js";

const directories: string[] = [];
const fixture = {
  apiKey: "synthetic-test-key",
  projectId: "00000000-0000-4000-8000-000000000001",
  apiOrigin: productionApiOrigin,
};
function environment() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "browse-file-auth-test-")));
  directories.push(directory);
  return { BROWSERBASE_CONFIG_DIR: directory };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("explicit plaintext credential storage", () => {
  it("writes a private plaintext file only when selected and rejects broad permissions", () => {
    const env = environment();
    writeCredential(fixture, env, "file");
    expect(savedCredentialStore(env)).toBe("file");
    expect(readFileSync(credentialPath(env), "utf8")).toContain(fixture.apiKey);
    expect(lstatSync(credentialPath(env)).mode & 0o777).toBe(0o600);
    expect(readCredential(env)).toEqual(fixture);
    chmodSync(credentialPath(env), 0o644);
    expect(() => readCredential(env)).toThrow("securely read");
    chmodSync(credentialPath(env), 0o600);
    expect(removeCredential(env)).toBe(true);
  });

  it("cleans up the previous backend when explicitly switching storage", () => {
    const backend = fakeKeyring();
    const env = environment();
    writeCredential(fixture, env);
    expect(backend.secrets.size).toBe(1);
    writeCredential(fixture, env, "file");
    expect(backend.secrets.size).toBe(0);
    expect(savedCredentialStore(env)).toBe("file");
    writeCredential(fixture, env);
    expect(backend.secrets.size).toBe(1);
    expect(savedCredentialStore(env)).toBe("keychain");
    expect(readFileSync(credentialPath(env), "utf8")).not.toContain(fixture.apiKey);
    expect(readCredential(env)).toEqual(fixture);
  });

  it("keeps the keychain login when switching to a file cannot remove its OS entry", () => {
    const backend = fakeKeyring();
    const env = environment();
    writeCredential(fixture, env);
    const originalReference = readFileSync(credentialPath(env), "utf8");
    backend.state.rejectDelete = true;
    expect(() => writeCredential(fixture, env, "file")).toThrow("Could not update saved login");
    expect(readFileSync(credentialPath(env), "utf8")).toBe(originalReference);
    expect(readCredential(env)).toEqual(fixture);
    expect(backend.secrets.size).toBe(1);
    backend.state.rejectDelete = false;
    writeCredential(fixture, env, "file");
    expect(savedCredentialStore(env)).toBe("file");
    expect(backend.secrets.size).toBe(0);
  });

  it("keeps the file login and removes a new OS entry when switching cannot save its reference", () => {
    const backend = fakeKeyring();
    const env = environment();
    writeCredential(fixture, env, "file");
    const originalRecord = readFileSync(credentialPath(env), "utf8");
    vi.spyOn(metadata, "writePrivateRecord").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect(() => writeCredential(fixture, env)).toThrow("Could not update saved login");
    expect(readFileSync(credentialPath(env), "utf8")).toBe(originalRecord);
    expect(readCredential(env)).toEqual(fixture);
    expect(backend.secrets.size).toBe(0);
    writeCredential(fixture, env);
    expect(savedCredentialStore(env)).toBe("keychain");
    expect(backend.secrets.size).toBe(1);
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
