import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const OPENCODE_DIRECTORY_ENV = new Set([
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_DATA_DIR",
  "OPENCODE_CACHE_DIR",
  "OPENCODE_LOG_DIR",
  "OPENCODE_STATE_DIR",
]);

/** Private HOME/XDG and config dir so the host does not inherit ambient OpenCode settings. */
export async function isolatedOpenCodeEnv(
  configRoot: string,
  source: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, string>> {
  const home = join(configRoot, "home");
  await mkdir(join(home, ".config"), { recursive: true, mode: 0o700 });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!value || OPENCODE_DIRECTORY_ENV.has(key)) continue;
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
