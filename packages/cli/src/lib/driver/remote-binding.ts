import type { RemoteCapability } from "./remote-types.js";

let cached: RemoteCapability | undefined;

/**
 * Load the Browserbase capability. The full build ships `remote.js`; the
 * local-only build omits it, so we fall back to `remote.disabled.js`. The full
 * specifier is held in a variable so the local-only TypeScript program can
 * exclude `remote.ts` without the compiler eagerly pulling it back in.
 */
export async function getRemote(): Promise<RemoteCapability> {
  if (cached) return cached;

  const fullModule = "./remote.js";
  try {
    cached = (await import(fullModule)) as unknown as RemoteCapability;
  } catch {
    cached =
      (await import("./remote.disabled.js")) as unknown as RemoteCapability;
  }

  return cached;
}
