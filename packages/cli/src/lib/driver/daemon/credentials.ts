import { createHash } from "node:crypto";

import { getRemote } from "../remote-binding.js";

/**
 * Credentials the client forwards to a running daemon so that an inline or
 * exported API key set *after* the daemon started is still honored.
 *
 * The daemon is a detached background process whose `process.env` is captured
 * once at spawn time. A key set on a *later* client invocation never reaches
 * that process on its own, so the client ships the relevant credentials over
 * the (localhost, owner-only) driver socket with every command. The daemon
 * threads them straight into the Stagehand constructor at init — it never
 * writes them back into its own `process.env`, so the key's only home is the
 * live session, not the daemon's global environment.
 *
 * The *list* of forwardable keys is Browserbase-specific and therefore lives
 * behind the remote capability (`remote.ts`), which the local-only build
 * excludes. That keeps the literal key names out of the CDP-only artifact, the
 * same security contract that confines `BROWSERBASE_API_KEY` reads to
 * `remote.ts`. The signature side iterates the received object's own keys, so
 * it needs no key list and stays key-name-free.
 */
export type ForwardedCredentials = Record<string, string>;

/** Collect the forwardable credentials that are set in the caller's env. */
export async function collectClientCredentials(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ForwardedCredentials | undefined> {
  const keys = (await getRemote()).forwardedCredentialKeys();
  const credentials: ForwardedCredentials = {};
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) {
      credentials[key] = value;
    }
  }
  return Object.keys(credentials).length > 0 ? credentials : undefined;
}

/**
 * Stable, secret-free fingerprint of a forwarded credential set, used only to
 * detect whether the caller's credentials changed between requests (so a cold
 * session can bust its cached init-failure backoff and retry with the new key).
 * Hashing keeps the raw key out of any retained field. Iterates the received
 * object's own keys — the client already filtered to the forwardable set — so
 * this carries no literal key names. Returns "" for an empty/absent set.
 */
export function credentialSignature(
  credentials: ForwardedCredentials | undefined,
): string {
  if (!credentials) return "";
  const entries = Object.entries(credentials)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return "";
  const hash = createHash("sha256");
  for (const [key, value] of entries) {
    hash.update(key);
    hash.update("\0");
    hash.update(value);
    hash.update("\0");
  }
  return hash.digest("hex");
}
