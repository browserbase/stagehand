/**
 * Resolution and dynamic loading of the Stagehand v4 SDK.
 *
 * The SDK comes exclusively from STAGEHAND_V4_SDK_PATH — the SDK's entry
 * file (e.g. `<v4-spike>/packages/sdk-ts/src/index.ts`). This is the
 * ticket's "point STAGEHAND_V4_SDK_PATH at v4-spike" knob, and it survives
 * the v4-branch migration (repoint at the in-repo path).
 *
 * Compile-time types still come from the generated `.v4-sdk-types` shim, so
 * an env override changes which code runs, not which types check. Keep the
 * shim regenerated against whatever checkout the env points at
 * (V4_API_LOGS #16).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const STAGEHAND_V4_SDK_PATH_ENV = "STAGEHAND_V4_SDK_PATH";

export type V4SdkModule =
  typeof import("@browserbasehq/stagehand-v4-spike-sdk-ts");

/** Injectable for unit tests; defaults to the real dynamic import. */
export type V4SdkImporter = (specifier: string) => Promise<unknown>;

/**
 * Resolve the configured SDK entry file, or undefined when unset (package
 * link is used). Loud on misconfiguration: a path that doesn't exist or
 * isn't a file throws rather than silently falling back.
 */
export function resolveV4SdkPath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const configured = env[STAGEHAND_V4_SDK_PATH_ENV]?.trim();
  if (!configured) return undefined;

  const resolved = path.resolve(configured);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(
      `${STAGEHAND_V4_SDK_PATH_ENV} does not point to a file: ${resolved} ` +
        `(expected the v4 SDK entry, e.g. <v4-spike>/packages/sdk-ts/src/index.ts)`,
    );
  }
  return resolved;
}

/**
 * Load the v4 SDK module from STAGEHAND_V4_SDK_PATH. The env var is
 * required: there is deliberately no package fallback — the former
 * `link:../../v4-spike/...` dependency broke every fresh clone and CI
 * runner that lacked the nested checkout, so the SDK location is pure,
 * explicit configuration (types come from the committed .v4-sdk-types
 * declarations either way).
 */
export async function loadV4Sdk(
  importer: V4SdkImporter = (specifier) => import(specifier),
  env: NodeJS.ProcessEnv = process.env,
): Promise<V4SdkModule> {
  const explicitPath = resolveV4SdkPath(env);
  if (!explicitPath) {
    throw new Error(
      `${STAGEHAND_V4_SDK_PATH_ENV} is required for v4 runs: point it at the ` +
        `v4 SDK entry file, e.g. <v4-spike>/packages/sdk-ts/src/index.ts`,
    );
  }
  return (await importer(pathToFileURL(explicitPath).href)) as V4SdkModule;
}
