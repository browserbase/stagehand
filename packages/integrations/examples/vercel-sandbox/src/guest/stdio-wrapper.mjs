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

const signalHandlers = new Map();
for (const signal of ["SIGINT", "SIGTERM"]) {
  const handler = () => child.kill(signal);
  signalHandlers.set(signal, handler);
  process.on(signal, handler);
}

child.on("exit", (code, signal) => {
  for (const [handledSignal, handler] of signalHandlers) {
    process.removeListener(handledSignal, handler);
  }
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
