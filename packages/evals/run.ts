import { spawnSync } from "node:child_process";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config();

const args: readonly string[] = process.argv.slice(2);

const wantsHelp: boolean = args.some((a) => /^(?:--?)?(?:h|help)$/i.test(a));
const wantsMan: boolean = args.some((a) => /^(?:--?)?man$/i.test(a));

// Skip build if just showing help
if (!wantsHelp && !wantsMan) {
  const build = spawnSync("pnpm", ["run", "build"], {
    stdio: "inherit",
    cwd: "../..",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const run = spawnSync("tsx", ["index.eval.ts", ...args], {
  stdio: "inherit",
  cwd: __dirname,
});
process.exit(run.status ?? 0);
