/**
 * `evals config core` — configuration for the core (deterministic) tier's
 * tool adapter defaults. Namespaced under `config` so it lives beside run
 * defaults.
 *
 * Subcommands (what this module sees after `config core` is stripped):
 *   (none)                print current core section
 *   path                  print the config file path
 *   set <k> <v>           set tool or startup
 *   reset [key]           reset one key or the whole core section
 *   setup                 (placeholder — interactive wizard TODO)
 *
 * Scope is intentionally narrow: only `tool` and `startup` persist. Native
 * adapter options stay in code / env vars. Per-task overrides are not
 * supported — config applies globally to every core run.
 *
 * Validation uses the live adapter registry so `set startup` can only
 * accept values the currently-configured tool actually supports.
 */

import { bold, cyan, dim, gray, green, red, yellow } from "../format.js";
import {
  readConfig,
  writeConfig,
  resolveConfigPath,
  type CoreConfigSection,
} from "./config.js";

type CoreKey = keyof CoreConfigSection;
const VALID_KEYS: CoreKey[] = ["tool", "startup"];

export async function handleCore(
  args: string[],
  entryDir: string,
): Promise<void> {
  const sub = args[0];

  if (!sub) {
    printCoreConfig(entryDir);
    return;
  }

  if (sub === "help" || sub === "-h" || sub === "--help") {
    const { printConfigCoreHelp } = await import("./help.js");
    printConfigCoreHelp();
    return;
  }

  // Per-sub help. Only intercepted at args[1] (immediately after the verb)
  // so leaf values like `set tool --help` aren't swallowed as help.
  if (args[1] === "--help" || args[1] === "-h" || args[1] === "help") {
    const { printConfigCoreHelp } = await import("./help.js");
    printConfigCoreHelp();
    return;
  }

  if (sub === "path") {
    console.log(resolveConfigPath(entryDir));
    return;
  }

  if (sub === "setup") {
    console.log(
      dim(
        "  evals config core setup — interactive wizard coming soon. For now use " +
          cyan("evals config core set"),
      ),
    );
    return;
  }

  if (sub === "set") {
    if (args.length < 3) {
      console.error(red("  Usage: config core set <tool|startup> <value>"));
      process.exitCode = 1;
      return;
    }
    const key = args[1] as CoreKey;
    const value = args[2];
    await setCoreKey(entryDir, key, value);
    return;
  }

  if (sub === "reset") {
    const key = args[1] as CoreKey | undefined;
    resetCoreKey(entryDir, key);
    return;
  }

  console.error(red(`  Unknown "config core" subcommand "${sub}"`));
  printCoreUsage();
  process.exitCode = 1;
}

function printCoreUsage(): void {
  console.log(dim("  Usage: config core [set <k> <v>|reset [key]|path|setup]"));
}

export function printCoreConfig(entryDir: string): void {
  const config = readConfig(entryDir);
  const core = config.core ?? {};

  console.log(`\n  ${bold("Core configuration:")}\n`);
  console.log(
    `    ${cyan("tool")}     ${core.tool ?? gray("(runner default: understudy_code)")}`,
  );
  console.log(
    `    ${cyan("startup")}  ${core.startup ?? gray("(inferred from tool + env)")}`,
  );
  console.log("");
  console.log(dim(`  Config file: ${resolveConfigPath(entryDir)}`));
  console.log("");
}

async function setCoreKey(
  entryDir: string,
  key: CoreKey,
  value: string,
): Promise<void> {
  if (!VALID_KEYS.includes(key)) {
    console.error(red(`  Unknown core key "${key}"`));
    console.log(dim(`  Valid keys: ${VALID_KEYS.join(", ")}`));
    process.exitCode = 1;
    return;
  }

  const { listCoreTools, getCoreTool } = await import(
    "../../core/tools/registry.js"
  );
  const validTools = listCoreTools();

  const config = readConfig(entryDir);
  const core: CoreConfigSection = { ...(config.core ?? {}) };

  if (key === "tool") {
    if (!validTools.includes(value as (typeof validTools)[number])) {
      console.error(red(`  Invalid tool "${value}"`));
      console.log(dim(`  Known tools: ${validTools.join(", ")}`));
      process.exitCode = 1;
      return;
    }

    // If changing tool invalidates the currently-set startup, reset it
    // with a warning so the config never persists an inconsistent pair.
    if (core.startup) {
      const newTool = getCoreTool(value as (typeof validTools)[number]);
      if (!newTool.supportedStartupProfiles.includes(core.startup as never)) {
        console.log(
          yellow(
            `  ⚠ Resetting startup "${core.startup}" — not supported by ${value}.`,
          ),
        );
        core.startup = undefined;
      }
    }
    core.tool = value;
  } else if (key === "startup") {
    // startup must be supported by the currently-configured tool.
    const toolSurface = core.tool as (typeof validTools)[number] | undefined;
    if (!toolSurface) {
      console.error(
        red("  Cannot set startup without a tool. Set core.tool first."),
      );
      console.log(dim(`  Example: evals core config set tool understudy_code`));
      process.exitCode = 1;
      return;
    }
    const tool = getCoreTool(toolSurface);
    const supported = tool.supportedStartupProfiles;
    if (!supported.includes(value as never)) {
      console.error(
        red(`  Tool "${toolSurface}" does not support startup "${value}".`),
      );
      console.log(dim(`  Supported: ${supported.join(", ")}`));
      process.exitCode = 1;
      return;
    }
    core.startup = value;
  }

  config.core = pruneCore(core);
  writeConfig(entryDir, config);
  console.log(green(`  ✓ Set core.${key} to ${value}`));
}

function resetCoreKey(entryDir: string, key: CoreKey | undefined): void {
  const config = readConfig(entryDir);

  if (!key) {
    config.core = undefined;
    writeConfig(entryDir, config);
    console.log(green("  ✓ Reset core configuration"));
    return;
  }

  if (!VALID_KEYS.includes(key)) {
    console.error(red(`  Unknown core key "${key}"`));
    process.exitCode = 1;
    return;
  }

  const core: CoreConfigSection = { ...(config.core ?? {}) };
  core[key] = undefined;
  config.core = pruneCore(core);
  writeConfig(entryDir, config);
  console.log(green(`  ✓ Reset core.${key}`));
}

function pruneCore(core: CoreConfigSection): CoreConfigSection | undefined {
  const pruned: CoreConfigSection = {};
  if (core.tool) pruned.tool = core.tool;
  if (core.startup) pruned.startup = core.startup;
  return Object.keys(pruned).length > 0 ? pruned : undefined;
}
