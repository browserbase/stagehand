/**
 * `evals config tracing` — persisted defaults for the trace transport and
 * its sinks. Namespaced under `config` so it lives beside run defaults.
 *
 * Subcommands (what this module sees after `config tracing` is stripped):
 *   (none)                print current tracing section + effective values
 *   path                  print the config file path
 *   set <k> <v>           set transport | braintrustProject | langsmithProject
 *   reset [key]           reset one key or the whole tracing section
 *
 * Each key is a default for one env var (see TRACING_ENV_VARS). The env var
 * always wins, so a shell export or CI secret overrides whatever is stored
 * here. Credentials (API keys) are never stored in config — they stay in
 * .env / the shell, surfaced by `evals doctor`.
 */

import { bold, cyan, dim, gray, green, red } from "../format.js";
import {
  readConfig,
  writeConfig,
  resolveConfigPath,
  TRACING_ENV_VARS,
  type TraceTransport,
  type TracingConfigSection,
} from "./config.js";

type TracingKey = keyof TracingConfigSection;
const VALID_KEYS: TracingKey[] = ["transport", "braintrustProject", "langsmithProject"];
const TRANSPORTS: TraceTransport[] = ["native", "otel"];

export async function handleTracing(args: string[], entryDir: string): Promise<void> {
  const sub = args[0];

  if (!sub) {
    printTracingConfig(entryDir);
    return;
  }

  if (sub === "help" || sub === "-h" || sub === "--help") {
    const { printConfigTracingHelp } = await import("./help.js");
    printConfigTracingHelp();
    return;
  }

  // Per-sub help. Only intercepted at args[1] (immediately after the verb)
  // so leaf values like `set transport --help` aren't swallowed as help.
  if (args[1] === "--help" || args[1] === "-h" || args[1] === "help") {
    const { printConfigTracingHelp } = await import("./help.js");
    printConfigTracingHelp();
    return;
  }

  if (sub === "path") {
    console.log(resolveConfigPath(entryDir));
    return;
  }

  if (sub === "set") {
    if (args.length < 3) {
      console.error(
        red("  Usage: config tracing set <transport|braintrustProject|langsmithProject> <value>"),
      );
      process.exitCode = 1;
      return;
    }
    setTracingKey(entryDir, args[1] as TracingKey, args.slice(2).join(" "));
    return;
  }

  if (sub === "reset") {
    resetTracingKey(entryDir, args[1] as TracingKey | undefined);
    return;
  }

  console.error(red(`  Unknown "config tracing" subcommand "${sub}"`));
  console.log(dim("  Usage: config tracing [set <k> <v>|reset [key]|path]"));
  process.exitCode = 1;
}

/**
 * Effective value for one tracing key: env var if set, else the persisted
 * config value, else undefined. Exported so `doctor` reports the same
 * resolution the runner sees.
 */
export function resolveTracingValue(
  key: TracingKey,
  tracing: TracingConfigSection | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { value: string | undefined; source: "env" | "config" | "none" } {
  const fromEnv = env[TRACING_ENV_VARS[key]]?.trim();
  if (fromEnv) return { value: fromEnv, source: "env" };
  const fromConfig = tracing?.[key];
  if (fromConfig) return { value: fromConfig, source: "config" };
  return { value: undefined, source: "none" };
}

export function printTracingConfig(entryDir: string): void {
  const config = readConfig(entryDir);
  const tracing = config.tracing ?? {};

  console.log(`\n  ${bold("Tracing configuration:")}\n`);
  for (const key of VALID_KEYS) {
    const stored = tracing[key];
    const effective = resolveTracingValue(key, tracing);
    const label = key.padEnd(18);
    const shown = stored ?? gray(defaultHint(key));
    const envNote =
      effective.source === "env"
        ? dim(`  (overridden by ${TRACING_ENV_VARS[key]}=${effective.value})`)
        : "";
    console.log(`    ${cyan(label)} ${shown}${envNote}`);
  }
  console.log("");
  console.log(
    dim(`  Env vars win over these defaults: ${Object.values(TRACING_ENV_VARS).join(", ")}`),
  );
  console.log(dim(`  Config file: ${resolveConfigPath(entryDir)}`));
  console.log("");
}

function defaultHint(key: TracingKey): string {
  switch (key) {
    case "transport":
      return "(default: native)";
    case "braintrustProject":
      return "(default: stagehand[-core][-dev] by tier/CI)";
    case "langsmithProject":
      return "(default: LangSmith workspace default)";
  }
}

function setTracingKey(entryDir: string, key: TracingKey, value: string): void {
  if (!VALID_KEYS.includes(key)) {
    console.error(red(`  Unknown tracing key "${key}"`));
    console.log(dim(`  Valid keys: ${VALID_KEYS.join(", ")}`));
    process.exitCode = 1;
    return;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    console.error(
      red(`  ${key} cannot be empty — use \`config tracing reset ${key}\` to clear it.`),
    );
    process.exitCode = 1;
    return;
  }

  const config = readConfig(entryDir);
  const tracing: TracingConfigSection = { ...config.tracing };

  if (key === "transport") {
    const normalized = trimmed.toLowerCase() as TraceTransport;
    if (!TRANSPORTS.includes(normalized)) {
      console.error(red(`  transport must be one of: ${TRANSPORTS.join(", ")}`));
      process.exitCode = 1;
      return;
    }
    tracing.transport = normalized;
  } else {
    tracing[key] = trimmed;
  }

  config.tracing = pruneTracing(tracing);
  writeConfig(entryDir, config);
  console.log(green(`  ✓ Set tracing.${key} to ${tracing[key]}`));
  const env = process.env[TRACING_ENV_VARS[key]];
  if (env) {
    console.log(
      dim(`  Note: ${TRACING_ENV_VARS[key]}=${env} is set in this shell and will take precedence.`),
    );
  }
}

function resetTracingKey(entryDir: string, key: TracingKey | undefined): void {
  const config = readConfig(entryDir);

  if (!key) {
    config.tracing = undefined;
    writeConfig(entryDir, config);
    console.log(green("  ✓ Reset tracing configuration"));
    return;
  }

  if (!VALID_KEYS.includes(key)) {
    console.error(red(`  Unknown tracing key "${key}"`));
    process.exitCode = 1;
    return;
  }

  const tracing: TracingConfigSection = { ...config.tracing };
  tracing[key] = undefined;
  config.tracing = pruneTracing(tracing);
  writeConfig(entryDir, config);
  console.log(green(`  ✓ Reset tracing.${key}`));
}

function pruneTracing(tracing: TracingConfigSection): TracingConfigSection | undefined {
  const pruned: TracingConfigSection = {};
  if (tracing.transport) pruned.transport = tracing.transport;
  if (tracing.braintrustProject) pruned.braintrustProject = tracing.braintrustProject;
  if (tracing.langsmithProject) pruned.langsmithProject = tracing.langsmithProject;
  return Object.keys(pruned).length > 0 ? pruned : undefined;
}
