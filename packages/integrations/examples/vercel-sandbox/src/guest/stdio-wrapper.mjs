import { spawn } from "node:child_process";

const child = spawn("/vercel/sandbox/stagehand-runtime/node_modules/.bin/stagehand-codemode", [], {
  cwd: "/vercel/sandbox/stagehand-runtime",
  env: process.env,
  stdio: ["inherit", "inherit", "inherit"],
});

const signalHandlers = new Map();
const removeSignalHandlers = () => {
  for (const [handledSignal, handler] of signalHandlers) {
    process.removeListener(handledSignal, handler);
  }
};
for (const signal of ["SIGINT", "SIGTERM"]) {
  const handler = () => child.kill(signal);
  signalHandlers.set(signal, handler);
  process.on(signal, handler);
}

child.on("error", () => {
  removeSignalHandlers();
  process.stderr.write("Stagehand code-mode process failed to start.\n");
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  removeSignalHandlers();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
