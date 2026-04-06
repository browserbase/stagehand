import fs from "node:fs";
import path from "node:path";
import { bold, dim, cyan, gray } from "../format.js";
import { getPackageRootDir } from "../../runtimePaths.js";

export function printConfig(): void {
  // Read from dist/cli/ first (has merged user defaults from build),
  // fall back to source root config
  const distConfigPath = path.join(getPackageRootDir(), "dist", "cli", "evals.config.json");
  const sourceConfigPath = path.join(getPackageRootDir(), "evals.config.json");
  const configPath = fs.existsSync(distConfigPath) ? distConfigPath : sourceConfigPath;

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    console.log(dim("  Could not read evals.config.json"));
    return;
  }

  const defaults = (config.defaults ?? {}) as Record<string, unknown>;

  console.log(`\n  ${bold("Configuration:")}\n`);
  console.log(`    ${cyan("env")}          ${defaults.env ?? "local"}`);
  console.log(`    ${cyan("trials")}       ${defaults.trials ?? 3}`);
  console.log(`    ${cyan("concurrency")}  ${defaults.concurrency ?? 10}`);
  console.log(`    ${cyan("api")}          ${defaults.api ?? false}`);
  console.log(`    ${cyan("model")}        ${defaults.model ?? gray("(default per category)")}`);
  console.log(`    ${cyan("provider")}     ${defaults.provider ?? gray("(all)")}`);

  const env = process.env;
  const overrides: string[] = [];
  if (env.EVAL_ENV) overrides.push(`EVAL_ENV=${env.EVAL_ENV}`);
  if (env.EVAL_MODELS) overrides.push(`EVAL_MODELS=${env.EVAL_MODELS}`);
  if (env.EVAL_PROVIDER) overrides.push(`EVAL_PROVIDER=${env.EVAL_PROVIDER}`);
  if (env.USE_API) overrides.push(`USE_API=${env.USE_API}`);

  if (overrides.length > 0) {
    console.log(`\n    ${dim("Env overrides:")}`);
    for (const o of overrides) {
      console.log(`      ${gray(o)}`);
    }
  }

  console.log("");
}
