import { createHash } from "node:crypto";

import { getRemote } from "../remote-binding.js";

/**
 * Env vars the client forwards to a running daemon so that an inline or
 * exported API key set *after* the daemon started is still honored.
 *
 * The daemon is a detached background process whose `process.env` is captured
 * once at spawn time. A key set on a *later* client invocation never reaches
 * that process on its own, so the client ships the relevant env vars over
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
export type ForwardedEnv = Record<string, string>;

/** Collect the forwardable env vars that are set in the caller's env. */
export async function collectForwardedEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ForwardedEnv | undefined> {
  const keys = (await getRemote()).forwardedEnvKeys();
  const forwardedEnv: ForwardedEnv = {};
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) {
      forwardedEnv[key] = value;
    }
  }
  return Object.keys(forwardedEnv).length > 0 ? forwardedEnv : undefined;
}

/**
 * Stable, secret-free fingerprint of a forwarded env set, used only to
 * detect whether the caller's forwarded env changed between requests (so a cold
 * session can bust its cached init-failure backoff and retry with the new key).
 * Hashing keeps the raw key out of any retained field. Iterates the received
 * object's own keys — the client already filtered to the forwardable set — so
 * this carries no literal key names. Returns "" for an empty/absent set.
 */
export function forwardedEnvSignature(
  forwardedEnv: ForwardedEnv | undefined,
): string {
  if (!forwardedEnv) return "";
  const entries = Object.entries(forwardedEnv)
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
