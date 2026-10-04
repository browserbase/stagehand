import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Operator OpenCode paths that would load a global CLI profile or extra plugins. */
const OPERATOR_OPENCODE_PATH_KEYS = new Set([
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_DATA_DIR",
  "OPENCODE_CACHE_DIR",
  "OPENCODE_LOG_DIR",
  "OPENCODE_STATE_DIR",
]);

/**
 * Run the embedded `@opencode/sdk` host without inheriting the operator's
 * OpenCode CLI config. v2 still walks from cwd to `/` and `~/.config/opencode`
 * (https://opencode.ai/v2/docs/config); a private HOME/XDG plus config dir
 * keeps that search inside the eval workspace. Provider API keys stay.
 */
export async function isolatedOpenCodeEnv(
  configRoot: string,
  source: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, string>> {
  const home = join(configRoot, "home");
  await mkdir(join(home, ".config"), { recursive: true, mode: 0o700 });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!value || OPERATOR_OPENCODE_PATH_KEYS.has(key)) continue;
    env[key] = value;
  }
  return {
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    OPENCODE_CONFIG_DIR: configRoot,
  };
}
