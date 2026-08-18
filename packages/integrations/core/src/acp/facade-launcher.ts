import { spawn } from "node:child_process";

import { buildAcpFacadeRuntimeEnv } from "./env.js";

const [facadeServerPath, ...facadeArgs] = process.argv.slice(2);
if (!facadeServerPath) throw new Error("Stagehand ACP facade launcher requires a server path.");

// ACP agents may merge an MCP server's declared env with their own environment.
// Start the actual facade as a second process so its environment is enforced here.
const facade = spawn(process.execPath, [facadeServerPath, ...facadeArgs], {
  env: buildAcpFacadeRuntimeEnv(),
  stdio: "inherit",
});

let exiting = false;
const forwardSignal = (signal: NodeJS.Signals) => {
  if (!facade.kill(signal)) process.exit(signal === "SIGINT" ? 130 : 143);
};

process.once("SIGINT", () => forwardSignal("SIGINT"));
process.once("SIGTERM", () => forwardSignal("SIGTERM"));
facade.once("error", (error) => {
  process.stderr.write(`Unable to start Stagehand facade: ${error.message}\n`);
  process.exit(1);
});
facade.once("exit", (code, signal) => {
  if (exiting) return;
  exiting = true;
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
