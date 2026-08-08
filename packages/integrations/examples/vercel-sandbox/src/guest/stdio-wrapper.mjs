import { spawn } from "node:child_process";

const child = spawn(
  process.execPath,
  ["/vercel/sandbox/stagehand/packages/integrations/dist/codemode/stdio-server.mjs"],
  {
    cwd: "/vercel/sandbox/stagehand/packages/integrations",
    env: process.env,
    stdio: ["inherit", "inherit", "inherit"],
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
