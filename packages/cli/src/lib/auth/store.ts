import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { Entry } from "@napi-rs/keyring";

import { fail } from "../errors.js";
import { validateCredential, type SavedCredential } from "./credential.js";
import {
  credentialPath,
  readPrivateRecord,
  removePrivateRecord,
  requireFileCredentialStore,
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
export type CredentialStore = "keychain" | "file";
const require = createRequire(import.meta.url);
const keychainUnavailable =
  "OS credential storage is unavailable or locked. Unlock your keystore, use BROWSERBASE_API_KEY from your secret manager, or explicitly choose browse login --credential-store=file on macOS/Linux. No plaintext fallback was used.";

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

export function savedCredentialStore(
  env: NodeJS.ProcessEnv = process.env,
): CredentialStore | undefined {
  return readPrivateRecord(env)?.store;
}

export function requireSupportedCredentialStore(
  kind: CredentialStore | "auto" = "keychain",
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (kind === "file") {
    requireFileCredentialStore();
    return;
  }
  const previousStore = savedCredentialStore(env);
  try {
    entry("availability-check", env).getPassword();
  } catch {
    if (kind !== "auto" || previousStore === "keychain") fail(keychainUnavailable);
    requireFileCredentialStore();
  }
}

export function readCredential(env: NodeJS.ProcessEnv = process.env): SavedCredential | undefined {
  const record = readPrivateRecord(env);
  if (!record) return undefined;
  if (record.store === "file") {
    requireFileCredentialStore();
    return validateCredential(record);
  }
  let value: string | null;
  try {
    value = entry(record.account, env).getPassword();
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
  kind: CredentialStore | "auto" = "keychain",
): CredentialStore {
  if (kind === "file") requireFileCredentialStore();
  return withCredentialLock(env, () => updateCredential(credential, env, kind));
}

function updateCredential(
  credential: SavedCredential,
  env: NodeJS.ProcessEnv,
  kind: CredentialStore | "auto",
): CredentialStore {
  const checked = validateCredential(credential);
  const previous = readPrivateRecord(env);
  let store: CredentialStore = kind === "file" ? "file" : "keychain";
  const existingAccount =
    store === "keychain" && previous?.store === "keychain" ? previous.account : undefined;
  const account = existingAccount ?? randomUUID();
  let nextEntry: Entry | undefined;
  if (store === "keychain") {
    try {
      nextEntry = entry(account, env);
      nextEntry.setPassword(JSON.stringify(checked));
    } catch {
      if (kind !== "auto" || previous?.store === "keychain") fail(keychainUnavailable);
      try {
        nextEntry?.deleteCredential();
      } catch {
        /* A failed native write may also prevent cleanup. */
      }
      nextEntry = undefined;
      requireFileCredentialStore();
      store = "file";
    }
  }
  // Reuse the existing OS entry; its reference does not change on later logins.
  if (existingAccount) return "keychain";
  try {
    writePrivateRecord(
      store === "file"
        ? { version: 1, store: "file", ...checked }
        : { version: 1, store: "keychain", account },
      env,
    );
    if (previous?.store === "keychain") entry(previous.account, env).deleteCredential();
  } catch {
    // Try to restore the previous login when switching storage fails.
    try {
      if (previous) writePrivateRecord(previous, env);
      else removePrivateRecord(env);
    } catch {
      /* Preserve the original storage failure. */
    }
    try {
      nextEntry?.deleteCredential();
    } catch {
      /* The OS may have become locked during cleanup. */
    }
    fail("Could not update saved login. Check your credential store and retry.");
  }
  return store;
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
      entry(record.account, env).deleteCredential();
    } catch {
      fail(keychainUnavailable);
    }
  } else requireFileCredentialStore();
  return removePrivateRecord(env);
}
