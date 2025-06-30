import { spawnSync } from "node:child_process";
import process from "node:process";

const args: readonly string[] = process.argv.slice(2);

const wantsHelp: boolean = args.some((a) => /^(?:--?)?(?:h|help)$/i.test(a));
const wantsMan: boolean = args.some((a) => /^(?:--?)?man$/i.test(a));

if (!wantsHelp && !wantsMan) {
  const build = spawnSync("pnpm", ["run", "build"], { stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const run = spawnSync("tsx", ["evals/index.eval.ts", ...args], {
  stdio: "inherit",
});
process.exit(run.status ?? 0);
