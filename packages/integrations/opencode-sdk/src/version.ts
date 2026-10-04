import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The npm package this integration embeds. Stagehand evals and the example host
 * OpenCode in-process through this dependency — they do not spawn a globally
 * installed `opencode` CLI. See https://opencode.ai/v2/docs/build/sdk
 */
export const OPENCODE_SDK_PACKAGE = "@opencode/sdk";

export interface InstalledOpenCodeSdk {
  name: string;
  version: string;
  /** Package root under this workspace's node_modules (pnpm store symlink). */
  root: string;
}

/**
 * Read the `@opencode/sdk` package that Node actually resolved for this module.
 * `import.meta.resolve` follows package exports into `dist/`; we walk up to the
 * package root so the version comes from that install, not a PATH binary.
 */
export function readInstalledOpenCodeSdk(): InstalledOpenCodeSdk {
  let directory = dirname(fileURLToPath(import.meta.resolve(OPENCODE_SDK_PACKAGE)));
  while (true) {
    try {
      const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === OPENCODE_SDK_PACKAGE && typeof pkg.version === "string") {
        return { name: pkg.name, version: pkg.version, root: directory };
      }
    } catch {
      // dist/ and nested folders have no matching package.json.
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(
        `Cannot find ${OPENCODE_SDK_PACKAGE} in node_modules. Install workspace dependencies with pnpm.`,
      );
    }
    directory = parent;
  }
}

export const OPENCODE_SDK_VERSION = readInstalledOpenCodeSdk().version;
