import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { Entry } from "@napi-rs/keyring";

import { fail } from "../errors.js";
import { validateCredential, type SavedCredential } from "./credential.js";
import {
  credentialPath,
  readPrivateRecord,
  removePrivateRecord,
  writePrivateRecord,
  withCredentialLock,
} from "./file-store.js";

export { credentialPath } from "./file-store.js";
export {
  productionApiOrigin,
  developmentApiOrigin,
  validateCredential,
  type SavedCredential,
} from "./credential.js";
const require = createRequire(import.meta.url);
const keychainUnavailable =
  "OS credential storage is unavailable or locked. Unlock your keystore or use BROWSERBASE_API_KEY from your secret manager. No plaintext fallback was used.";

function entry(account: string, env: NodeJS.ProcessEnv): Entry {
  try {
    // Loading is lazy: unauthenticated local commands do not need native bindings.
    const { Entry: NativeEntry } = require("@napi-rs/keyring") as typeof import("@napi-rs/keyring");
    const namespace = createHash("sha256").update(credentialPath(env)).digest("hex");
    return new NativeEntry("com.browserbase.browse", `${namespace}:${account}`, {
      linux: { store: "secret-service" },
    });
  } catch {
    fail(keychainUnavailable);
  }
}

function accountFor(record: Record<string, unknown>): string {
  if (typeof record.account !== "string" || !/^[a-f0-9-]{36}$/.test(record.account))
    fail("Invalid OS credential reference. Run browse login again.");
  return record.account;
}

export function savedCredentialStore(env: NodeJS.ProcessEnv = process.env): "keychain" | undefined {
  const record = readPrivateRecord(env);
  if (!record) return undefined;
  if (record.store !== "keychain")
    fail("Invalid credential storage selection. Run browse login again.");
  return record.store;
}

export function requireSupportedCredentialStore(env: NodeJS.ProcessEnv = process.env): void {
  try {
    entry("availability-check", env).getPassword();
  } catch {
    fail(keychainUnavailable);
  }
}

export function readCredential(env: NodeJS.ProcessEnv = process.env): SavedCredential | undefined {
  const record = readPrivateRecord(env);
  if (!record) return undefined;
  if (record.store !== "keychain")
    fail("Invalid credential storage selection. Run browse login again.");
  let value: string | null;
  try {
    value = entry(accountFor(record), env).getPassword();
  } catch {
    fail(keychainUnavailable);
  }
  if (!value) fail("Saved OS credential is missing. Run browse login again.");
  let credential: unknown;
  try {
    credential = JSON.parse(value);
  } catch {
    fail("Invalid OS credential. Run browse login again.");
  }
  return validateCredential(credential);
}

export function writeCredential(
  credential: SavedCredential,
  env: NodeJS.ProcessEnv = process.env,
): void {
  return withCredentialLock(env, () => updateCredential(credential, env));
}

function updateCredential(credential: SavedCredential, env: NodeJS.ProcessEnv): void {
  const checked = validateCredential(credential);
  const previous = readPrivateRecord(env);
  if (previous && previous.store !== "keychain")
    fail("Invalid credential storage selection. Run browse login again.");
  const account = previous ? accountFor(previous) : randomUUID();
  const savedEntry = entry(account, env);
  try {
    savedEntry.setPassword(JSON.stringify(checked));
  } catch {
    fail(keychainUnavailable);
  }
  // Reuse the existing OS entry; its reference does not change on later logins.
  if (previous) return;
  try {
    writePrivateRecord({ version: 1, store: "keychain", account }, env);
  } catch {
    // Only a new entry needs cleanup when its reference could not be saved.
    try {
      savedEntry.deleteCredential();
    } catch {
      /* The OS may have become locked during cleanup. */
    }
    fail(
      "Could not update saved login. Check your credential store and retry; no automatic plaintext fallback was used.",
    );
  }
}

export function removeCredential(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!readPrivateRecord(env)) return false;
  return withCredentialLock(env, () => deleteCredential(env));
}

function deleteCredential(env: NodeJS.ProcessEnv): boolean {
  const record = readPrivateRecord(env);
  if (!record) return false;
  if (record.store === "keychain") {
    try {
      entry(accountFor(record), env).deleteCredential();
    } catch {
      fail(keychainUnavailable);
    }
  } else fail("Invalid credential storage selection. Check the credential metadata file.");
  return removePrivateRecord(env);
}
