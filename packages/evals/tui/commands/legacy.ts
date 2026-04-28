/**
 * Legacy escape hatch — spawns the pre-refactor `index.eval.ts` runner
 * instead of going through the unified in-process path.
 *
 * Opted into via `evals run <target> --legacy`. All env translation is
 * inherited from ResolvedRunOptions.envOverrides, so the spawned process
 * sees the same EVAL_* vars the unified path uses. Exit code of the child
 * becomes the exit code of this process. SIGINT/SIGTERM are forwarded.
 *
 * Only reachable from the argv dispatch in cli.ts — the REPL doesn't wire
 * --legacy because spawning a child that owns stdio mid-REPL is
 * disorienting.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { getPackageRootDir } from "../../runtimePaths.js";
import type { ResolvedRunOptions, RunFlags } from "./parse.js";
import type { TaskRegistry } from "../../framework/types.js";

const require = createRequire(import.meta.url);

export async function runLegacy(
  resolved: ResolvedRunOptions,
  flags: RunFlags,
  registry: TaskRegistry,
): Promise<never> {
  const packageRoot = getPackageRootDir();
  const indexEvalPath = path.join(packageRoot, "index.eval.ts");

  const legacyArgs = buildLegacyArgs(flags.target, resolved, registry);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...resolved.envOverrides,
  };

  let tsxCli: string | undefined;
  try {
    tsxCli = require.resolve("tsx/cli");
  } catch {
    // fall through to PATH-based tsx
  }

  const child = tsxCli
    ? spawn(process.execPath, [tsxCli, indexEvalPath, ...legacyArgs], {
        env,
        stdio: "inherit",
      })
    : spawn("tsx", [indexEvalPath, ...legacyArgs], {
        env,
        stdio: "inherit",
        shell: true,
      });

  const forward = (sig: NodeJS.Signals) => {
    if (!child.killed) child.kill(sig);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  return new Promise<never>(() => {
    child.on("exit", (code, signal) => {
      if (signal === "SIGINT") process.exit(130);
      if (signal === "SIGTERM") process.exit(143);
      process.exit(code ?? 0);
    });
  });
}

/**
 * Translate the unified CLI's target into the positional args that
 * `index.eval.ts` (via packages/evals/args.ts) expects.
 *
 *   (none) / "all"                         → []
 *   "b:gaia" / "benchmark:gaia"            → name=agent/gaia
 *   "agent/gaia" / anything with "/" or "*" → name=<target>
 *   known category                         → category <cat>
 *   known task name                        → name=<name>
 *   anything else                          → name=<target>  (let it error)
 */
function buildLegacyArgs(
  rawTarget: string | undefined,
  resolved: ResolvedRunOptions,
  registry: TaskRegistry,
): string[] {
  if (!rawTarget || rawTarget === "all") return [];

  const target = resolved.normalizedTarget ?? rawTarget;

  if (target.includes("/") || target.includes("*")) {
    return [`name=${target}`];
  }

  if (registry.byCategory.has(target)) {
    return ["category", target];
  }
  if (registry.byName.has(target)) {
    return [`name=${target}`];
  }

  return [`name=${target}`];
}
