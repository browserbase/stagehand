import { createHash } from "node:crypto";

import { getRemote } from "../remote-binding.js";

export type ForwardedEnv = Record<string, string>;

export async function collectForwardedEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ForwardedEnv | undefined> {
  const keys = (await getRemote()).forwardedEnvKeys();
  const forwardedEnv: ForwardedEnv = {};
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(env, key)) continue;
    const value = env[key];
    if (typeof value === "string" && value.length > 0) {
      forwardedEnv[key] = value;
    }
  }
  return Object.keys(forwardedEnv).length > 0 ? forwardedEnv : undefined;
}

export function forwardedEnvSignature(forwardedEnv: ForwardedEnv | undefined): string {
  if (!forwardedEnv) return "";
  const entries = Object.entries(forwardedEnv)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return "";
  const hash = createHash("sha256");
  for (const [key, value] of entries) {
    hash.update(`${Buffer.byteLength(key)}:${key}\0${Buffer.byteLength(value)}:${value}\0`);
  }
  return hash.digest("hex");
}
