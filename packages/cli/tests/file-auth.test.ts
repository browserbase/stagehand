import {
  chmodSync,
  existsSync,
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
  requireSupportedCredentialStore,
  savedCredentialStore,
  writeCredential,
} from "../src/lib/auth/store.js";
import * as metadata from "../src/lib/auth/file-store.js";
import { fakeKeyring } from "./helpers/keyring.js";

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

describe.skipIf(process.platform === "win32")("plaintext credential storage", () => {
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

  it.each(["malformed JSON", "unsupported version", "broad permissions"])(
    "gives repair instructions and retains the keystore reference for %s",
    (damage) => {
      const backend = fakeKeyring();
      const env = environment();
      writeCredential(fixture, env);
      const path = credentialPath(env);
      const original = readFileSync(path, "utf8");
      if (damage === "malformed JSON") writeFileSync(path, "{invalid");
      if (damage === "unsupported version")
        writeFileSync(path, JSON.stringify({ ...JSON.parse(original), version: 99 }));
      if (damage === "broad permissions") chmodSync(path, 0o644);
      let message = "";
      try {
        removeCredential(env);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(path);
      expect(message).toMatch(/repair|[Rr]estore/);
      expect(message).not.toContain(fixture.apiKey);
      expect(existsSync(path)).toBe(true);
      expect(backend.secrets.size).toBe(1);
      // Repairing the original reference permits normal keystore cleanup.
      writeFileSync(path, original);
      chmodSync(path, 0o600);
      expect(removeCredential(env)).toBe(true);
      expect(backend.secrets.size).toBe(0);
    },
  );

  it("reports malformed keystore references without discarding their metadata or secret", () => {
    const backend = fakeKeyring();
    const env = environment();
    writeCredential(fixture, env);
    const path = credentialPath(env);
    const original = readFileSync(path, "utf8");
    const damaged = JSON.stringify({ ...JSON.parse(original), account: "invalid" });
    writeFileSync(path, damaged);
    backend.constructor.mockClear();
    for (const operation of [readCredential, removeCredential]) {
      expect(() => operation(env)).toThrow("Could not securely read saved credentials");
    }
    expect(backend.constructor).not.toHaveBeenCalled();
    expect(readFileSync(path, "utf8")).toBe(damaged);
    expect(backend.secrets.size).toBe(1);
    writeFileSync(path, original);
    expect(readCredential(env)).toEqual(fixture);
    expect(removeCredential(env)).toBe(true);
    expect(backend.secrets.size).toBe(0);
  });

  it("retains damaged plaintext credentials for rollback, replacement, and logout", () => {
    const backend = fakeKeyring();
    const env = environment();
    writeCredential(fixture, env, "file");
    const path = credentialPath(env);
    const damaged = JSON.stringify({ version: 1, store: "file", ...fixture, apiKey: null });
    writeFileSync(path, damaged);
    expect(() => readCredential(env)).toThrow("Invalid saved credential");
    vi.spyOn(metadata, "writePrivateRecord").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect(() => writeCredential(fixture, env)).toThrow("Could not update saved login");
    expect(readFileSync(path, "utf8")).toBe(damaged);
    expect(backend.secrets.size).toBe(0);
    writeCredential(fixture, env, "file");
    expect(readCredential(env)).toEqual(fixture);
    writeFileSync(path, damaged);
    expect(removeCredential(env)).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it("rejects oversized records without replacing a usable saved login", () => {
    const env = environment();
    writeCredential(fixture, env, "file");
    expect(() =>
      writeCredential({ ...fixture, projectId: "project".repeat(6000) }, env, "file"),
    ).toThrow("Could not update saved login");
    expect(readCredential(env)).toEqual(fixture);
  });

  it("uses explicit file storage when the native keystore is unavailable", () => {
    const backend = fakeKeyring();
    backend.state.unavailable = true;
    const env = environment();
    expect(() => requireSupportedCredentialStore()).toThrow("--credential-store=file");
    backend.constructor.mockClear();
    requireSupportedCredentialStore("file", env);
    writeCredential(fixture, env, "file");
    expect(readCredential(env)).toEqual(fixture);
    expect(removeCredential(env)).toBe(true);
    expect(backend.constructor).not.toHaveBeenCalled();
  });

  it("prefers the keystore in auto mode and falls back for a new login when unavailable", () => {
    const backend = fakeKeyring();
    const env = environment();
    requireSupportedCredentialStore("auto", env);
    expect(writeCredential(fixture, env, "auto")).toBe("keychain");
    expect(readFileSync(credentialPath(env), "utf8")).not.toContain(fixture.apiKey);
    removeCredential(env);
    backend.state.unavailable = true;
    requireSupportedCredentialStore("auto", env);
    expect(writeCredential(fixture, env, "auto")).toBe("file");
    expect(readCredential(env)).toEqual(fixture);
    expect(lstatSync(credentialPath(env)).mode & 0o777).toBe(0o600);
    expect(() => requireSupportedCredentialStore("keychain", env)).toThrow("No plaintext fallback");
    expect(() => writeCredential(fixture, env, "keychain")).toThrow("No plaintext fallback");
    expect(savedCredentialStore(env)).toBe("file");
  });

  it("falls back when the keystore becomes unwritable after preflight", () => {
    const backend = fakeKeyring();
    const env = environment();
    requireSupportedCredentialStore("auto", env);
    backend.state.rejectWrite = true;
    expect(writeCredential(fixture, env, "auto")).toBe("file");
    expect(readCredential(env)).toEqual(fixture);
    expect(backend.secrets.size).toBe(0);
  });

  it("never automatically downgrades a keystore login created after preflight", () => {
    const backend = fakeKeyring();
    const env = environment();
    requireSupportedCredentialStore("auto", env);
    writeCredential(fixture, env);
    const originalReference = readFileSync(credentialPath(env), "utf8");
    backend.state.unavailable = true;
    expect(() => requireSupportedCredentialStore("auto", env)).toThrow("No plaintext fallback");
    expect(() => writeCredential(fixture, env, "auto")).toThrow("No plaintext fallback");
    backend.state.unavailable = false;
    backend.state.rejectWrite = true;
    expect(() => writeCredential(fixture, env, "auto")).toThrow("No plaintext fallback");
    expect(readFileSync(credentialPath(env), "utf8")).toBe(originalReference);
    expect(readCredential(env)).toEqual(fixture);
  });

  it("does not fall back for unsafe existing file permissions", () => {
    const backend = fakeKeyring();
    const env = environment();
    writeCredential(fixture, env, "file");
    chmodSync(credentialPath(env), 0o644);
    backend.state.unavailable = true;
    expect(() => requireSupportedCredentialStore("auto", env)).toThrow("securely read");
    expect(() => writeCredential(fixture, env, "auto")).toThrow("securely read");
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
});
