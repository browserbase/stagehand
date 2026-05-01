/**
 * Config command — read/write `evals.config.json`.
 *
 * The config file lives in the same directory as the running module:
 *   - Source mode (tsx packages/evals/cli.ts): packages/evals/evals.config.json
 *   - Built mode (dist/cli/cli.js):            packages/evals/dist/cli/evals.config.json
 *
 * `scripts/build-cli.ts` seeds the dist copy from source on build and
 * preserves user-set `defaults` across rebuilds — so per-mode storage is
 * intentional, not a bug.
 *
 * The `entryDir` is computed via `getCurrentDirPath()` at the top of
 * `cli.ts` (the entry) and passed down so this module stays side-effect
 * free.
 */

import fs from "node:fs";
import path from "node:path";
import { bold, dim, cyan, gray, green, red } from "../format.js";
import { parseAgentModes } from "./parse.js";
import type { AgentToolMode } from "@browserbasehq/stagehand";

type Defaults = {
  env?: string | null;
  trials?: number | null;
  concurrency?: number | null;
  provider?: string | null;
  model?: string | null;
  api?: boolean | null;
  verbose?: boolean | null;
  agentModes?: AgentToolMode[] | null;
};

export type CoreConfigSection = {
  tool?: string;
  startup?: string;
};

type ConfigFile = {
  defaults: Defaults;
  benchmarks?: Record<string, unknown>;
  core?: CoreConfigSection;
};

const VALID_KEYS: Array<keyof Defaults> = [
  "env",
  "trials",
  "concurrency",
  "provider",
  "model",
  "api",
  "verbose",
  "agentModes",
];

const DEFAULT_VALUES: Defaults = {
  env: "local",
  trials: 3,
  concurrency: 3,
  provider: null,
  model: null,
  api: false,
  verbose: false,
  agentModes: null,
};

export function resolveConfigPath(entryDir: string): string {
  return path.join(entryDir, "evals.config.json");
}

export function readConfig(entryDir: string): ConfigFile {
  const configPath = resolveConfigPath(entryDir);
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return {
      defaults: raw.defaults ?? {},
      benchmarks: raw.benchmarks ?? {},
      core: raw.core ?? undefined,
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new Error(`Missing config file: ${configPath}`, { cause: error });
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${configPath}: ${error.message}`, {
        cause: error,
      });
    }

    throw error;
  }
}

export function writeConfig(entryDir: string, config: ConfigFile): void {
  const configPath = resolveConfigPath(entryDir);
  // Prune undefined top-level fields so optional sections don't round-trip as `null`.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (v !== undefined) out[k] = v;
  }
  fs.writeFileSync(configPath, JSON.stringify(out, null, 2) + "\n");
}

export function printConfig(entryDir: string): void {
  const config = readConfig(entryDir);
  const defaults = config.defaults;

  console.log(`\n  ${bold("Configuration:")}\n`);
  console.log(`    ${cyan("env")}          ${defaults.env ?? "local"}`);
  console.log(`    ${cyan("trials")}       ${defaults.trials ?? 3}`);
  console.log(`    ${cyan("concurrency")}  ${defaults.concurrency ?? 3}`);
  console.log(`    ${cyan("api")}          ${defaults.api ?? false}`);
  console.log(`    ${cyan("verbose")}      ${defaults.verbose ?? false}`);
  console.log(
    `    ${cyan("agentModes")}   ${
      defaults.agentModes?.length
        ? defaults.agentModes.join(",")
        : gray("(default per model)")
    }`,
  );
  console.log(
    `    ${cyan("model")}        ${defaults.model ?? gray("(default per category)")}`,
  );
  console.log(
    `    ${cyan("provider")}     ${defaults.provider ?? gray("(all)")}`,
  );

  const env = process.env;
  const overrides: string[] = [];
  if (env.EVAL_ENV) overrides.push(`EVAL_ENV=${env.EVAL_ENV}`);
  if (env.EVAL_MODELS) overrides.push(`EVAL_MODELS=${env.EVAL_MODELS}`);
  if (env.EVAL_PROVIDER) overrides.push(`EVAL_PROVIDER=${env.EVAL_PROVIDER}`);
  if (env.USE_API) overrides.push(`USE_API=${env.USE_API}`);
  if (env.STAGEHAND_BROWSER_TARGET)
    overrides.push(`STAGEHAND_BROWSER_TARGET=${env.STAGEHAND_BROWSER_TARGET}`);

  if (overrides.length > 0) {
    console.log(`\n    ${dim("Env overrides:")}`);
    for (const o of overrides) {
      console.log(`      ${gray(o)}`);
    }
  }

  console.log("");
}

export async function handleConfig(
  args: string[],
  entryDir: string,
): Promise<void> {
  if (args.length === 0) {
    printConfig(entryDir);
    return;
  }

  const sub = args[0];

  if (sub === "core") {
    const { handleCore } = await import("./core.js");
    await handleCore(args.slice(1), entryDir);
    return;
  }

  if (sub === "path") {
    console.log(resolveConfigPath(entryDir));
    return;
  }

  if (sub === "set") {
    if (args.length < 3) {
      console.error(red("  Usage: config set <key> <value>"));
      process.exitCode = 1;
      return;
    }
    const key = args[1] as keyof Defaults;
    const rawValue = args.slice(2).join(" ");
    if (!VALID_KEYS.includes(key)) {
      console.error(red(`  Unknown config key "${key}"`));
      console.log(dim(`  Valid keys: ${VALID_KEYS.join(", ")}`));
      process.exitCode = 1;
      return;
    }
    const parsed = parseValue(key, rawValue);
    if (parsed === parseError) {
      process.exitCode = 1;
      return;
    }

    const config = readConfig(entryDir);
    config.defaults = { ...config.defaults, [key]: parsed };
    writeConfig(entryDir, config);
    console.log(green(`  ✓ Set ${key} to ${String(parsed)}`));
    return;
  }

  if (sub === "reset") {
    const config = readConfig(entryDir);
    if (args.length === 1) {
      config.defaults = { ...DEFAULT_VALUES };
      writeConfig(entryDir, config);
      console.log(green("  ✓ Reset all defaults"));
      return;
    }
    const key = args[1] as keyof Defaults;
    if (!VALID_KEYS.includes(key)) {
      console.error(red(`  Unknown config key "${key}"`));
      process.exitCode = 1;
      return;
    }
    config.defaults = { ...config.defaults, [key]: DEFAULT_VALUES[key] };
    writeConfig(entryDir, config);
    console.log(green(`  ✓ Reset ${key} to default`));
    return;
  }

  console.error(red(`  Unknown config subcommand "${sub}"`));
  console.log(dim("  Usage: config [set <key> <value> | reset [key] | path]"));
  process.exitCode = 1;
}

const parseError = Symbol("parse-error");

function parseValue(
  key: keyof Defaults,
  raw: string,
): string | number | boolean | AgentToolMode[] | null | typeof parseError {
  if (raw === "null" || raw === "none") return null;
  if (key === "env") {
    const normalized = raw.toLowerCase();
    if (normalized !== "local" && normalized !== "browserbase") {
      console.error(red("  env must be local or browserbase"));
      return parseError;
    }
    return normalized;
  }
  if (key === "trials" || key === "concurrency") {
    if (!/^[0-9]+$/.test(raw)) {
      console.error(red(`  ${key} must be a positive integer`));
      return parseError;
    }
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n <= 0) {
      console.error(red(`  ${key} must be a positive integer`));
      return parseError;
    }
    return n;
  }
  if (key === "api" || key === "verbose") {
    if (raw !== "true" && raw !== "false") {
      console.error(red(`  ${key} must be true or false`));
      return parseError;
    }
    return raw === "true";
  }
  if (key === "agentModes") {
    try {
      return parseAgentModes(raw);
    } catch (error) {
      console.error(
        red(error instanceof Error ? `  ${error.message}` : String(error)),
      );
      return parseError;
    }
  }
  return raw;
}
