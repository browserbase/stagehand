import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ensurePrivateDir, writePrivateFile } from "../driver/daemon/paths.js";
import { resolveConfigDir } from "../identity.js";
import { isRecord } from "../skills/shared.js";

export type BrowserMode = "local" | "cloud";

export interface SetupConfig {
  browser?: BrowserMode;
  apiKey?: string;
}

export function setupConfigPath(): string {
  return join(resolveConfigDir(), "browse.json");
}

export async function readSetupConfig(): Promise<SetupConfig> {
  let raw: string;
  try {
    raw = await readFile(setupConfigPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid browse setup config: ${setupConfigPath()}`);
  }
  if (
    !isRecord(value) ||
    (value.browser !== undefined &&
      value.browser !== "local" &&
      value.browser !== "cloud") ||
    (value.apiKey !== undefined && typeof value.apiKey !== "string")
  ) {
    throw new Error(`Invalid browse setup config: ${setupConfigPath()}`);
  }
  return value as SetupConfig;
}

export async function writeSetupConfig(config: SetupConfig): Promise<void> {
  await ensurePrivateDir(resolveConfigDir());
  await writePrivateFile(
    setupConfigPath(),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

export async function loadSetupEnvironment(): Promise<void> {
  const config = await readSetupConfig();
  if (config.browser) process.env.BROWSE_BROWSER ??= config.browser;
  if (config.apiKey && !process.env.BROWSERBASE_API_KEY) {
    process.env.BROWSERBASE_API_KEY = config.apiKey;
    // Project setups save keys too; only a saved cloud preference picks cloud.
    process.env.BROWSE_BROWSER ??= "local";
  }
}
