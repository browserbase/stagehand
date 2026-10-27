// Entry point of the standalone Stagehand MCP runtime that `browse setup`
// installs. It is copied beside its own node_modules, so it may import only
// those packages and ./server.js, never other browse modules.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import * as middleware from "stagehand-middleware";

import { startStagehandMcp } from "./server.js";

async function savedApiKey(): Promise<string | undefined> {
  const dir =
    process.env.BROWSERBASE_CONFIG_DIR ||
    join(
      process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
      "browserbase",
    );
  try {
    const config: unknown = JSON.parse(
      await readFile(join(dir, "browse.json"), "utf8"),
    );
    const apiKey = (config as { apiKey?: unknown } | null)?.apiKey;
    return typeof apiKey === "string" && apiKey ? apiKey : undefined;
  } catch {
    return undefined;
  }
}

const args = new Set(process.argv.slice(2));
if (args.has("--local") && args.has("--remote")) {
  process.stderr.write("Pass either --local or --remote, not both.\n");
  process.exit(2);
}
if (args.has("--local")) process.env.STAGEHAND_BROWSER = "local";
if (args.has("--remote")) process.env.STAGEHAND_BROWSER = "browserbase";
const apiKey = process.env.BROWSERBASE_API_KEY || (await savedApiKey());
if (apiKey) process.env.BROWSERBASE_API_KEY = apiKey;

const { version } = JSON.parse(
  await readFile(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };
await startStagehandMcp(version, middleware);
