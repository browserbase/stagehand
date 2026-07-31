#!/usr/bin/env node

import { createStagehandChildRuntime } from "./child-runtime.js";
import { runtimeConfigFromEnv } from "./config.js";
import { connectCodeModeStdio, startCodeModeHttpServer } from "./mcp-server.js";
import { CodeSessionManager } from "./session-manager.js";

const options = parseArgs(process.argv.slice(2));
const runtimeConfig = runtimeConfigFromEnv();
const manager = new CodeSessionManager({
  runtimeFactory: (codeSessionId) => createStagehandChildRuntime(codeSessionId, runtimeConfig),
  defaultTimeoutMs: runtimeConfig.defaultTimeoutMs,
});

let closing = false;
const shutdown = async (exitCode: number) => {
  if (closing) return;
  closing = true;
  await manager.closeAll().catch((error) => {
    process.stderr.write(`Failed to close code sessions: ${String(error)}\n`);
  });
  process.exit(exitCode);
};
process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));

if (options.stdio) {
  await connectCodeModeStdio(manager);
  process.stdin.once("end", () => void shutdown(0));
  process.stdin.once("close", () => void shutdown(0));
  process.stderr.write("Stagehand V4 code-mode MCP listening on stdio\n");
} else {
  const running = await startCodeModeHttpServer({
    manager,
    host: options.host,
    port: options.port,
    bearerToken: process.env.CODEMODE_MCP_BEARER_TOKEN,
  });
  process.stderr.write(`Stagehand V4 code-mode MCP listening on ${running.url}\n`);
}

type CliOptions = {
  stdio: boolean;
  host: string;
  port: number;
};

function parseArgs(args: string[]): CliOptions {
  let stdio = false;
  let host = "127.0.0.1";
  let port = 8932;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--stdio") {
      stdio = true;
      continue;
    }
    if (argument === "--host") {
      host = requireValue(args, ++index, "--host");
      continue;
    }
    if (argument === "--port") {
      const value = Number(requireValue(args, ++index, "--port"));
      if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
        throw new Error("--port must be an integer between 0 and 65535.");
      }
      port = value;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        [
          "Usage: stagehand-codemode [--stdio] [--host 127.0.0.1] [--port 8932]",
          "",
          "Environment:",
          "  BROWSERBASE_API_KEY          Required on the first code_execute run",
          "  STAGEHAND_MODEL_NAME         Optional provider/model name for AI methods",
          "  STAGEHAND_MODEL_API_KEY      Optional model provider key",
          "  CODEMODE_MCP_BEARER_TOKEN    Optional HTTP bearer token",
          "",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { stdio, host, port };
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}
