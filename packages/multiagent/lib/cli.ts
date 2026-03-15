#!/usr/bin/env node

import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import type {
  AgentHarnessName,
  MCPServerName,
  MultiAgentRunOptions,
} from "./types.js";
import {
  startStagehandAgentMCPServer,
  startUnderstudyMcpServer,
} from "./mcp/internal/index.js";
import { MultiAgentDriver } from "./runtime/driver.js";
import { UnsupportedAdapterError } from "./utils/errors.js";

function readList(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function printUsage(): void {
  console.error(`Usage:
  multiagent run --task "..." --agent claude-code --mcp playwright
  multiagent mcp-server <stagehand-agent|understudy> --cdp-url ws://127.0.0.1:9222/devtools/browser/...
`);
}

async function runCommand(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      task: { type: "string" },
      agent: { type: "string", multiple: true },
      mcp: { type: "string", multiple: true },
      browser: { type: "string" },
      "cdp-url": { type: "string" },
      headless: { type: "boolean" },
      cwd: { type: "string" },
      json: { type: "boolean" },
      model: { type: "string" },
    },
    allowPositionals: true,
  });

  if (values.config) {
    const configContents = await fs.readFile(values.config, "utf8");
    const config = JSON.parse(configContents) as MultiAgentRunOptions;
    const driver = new MultiAgentDriver(config);
    const result = await driver.run();

    if (values.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    process.stdout.write(`Browser ${result.browser.id} (${result.browser.type})\n`);
    for (const agent of result.agents) {
      process.stdout.write(`\n[${agent.harness}]\n`);
      if (agent.error) {
        process.stdout.write(`error: ${agent.error}\n`);
        continue;
      }
      process.stdout.write(`${agent.content}\n`);
    }
    return;
  }

  const agents = readList(values.agent) as AgentHarnessName[];
  const mcpServers = readList(values.mcp) as MCPServerName[];
  const task =
    values.task ??
    (argv.length > 0 && !argv[0]?.startsWith("-") ? argv[0] : undefined);

  if (!task || agents.length === 0) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const options: MultiAgentRunOptions = {
    task,
    cwd: values.cwd,
    browser: {
      type:
        values.browser === "cdp" || values["cdp-url"]
          ? "cdp"
          : "local",
      cdpUrl: values["cdp-url"],
      headless: values.headless,
    },
    agents: agents.map((agent) => ({
      type: agent,
      model: values.model,
    })),
    mcpServers: mcpServers.map((server) => ({
      type: server,
    })),
  };

  const driver = new MultiAgentDriver(options);
  const result = await driver.run();

  if (values.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Browser ${result.browser.id} (${result.browser.type})\n`);
  for (const agent of result.agents) {
    process.stdout.write(`\n[${agent.harness}]\n`);
    if (agent.error) {
      process.stdout.write(`error: ${agent.error}\n`);
      continue;
    }
    process.stdout.write(`${agent.content}\n`);
  }
}

function assertMcpServerType(value: string): asserts value is "stagehand-agent" | "understudy" {
  if (value !== "stagehand-agent" && value !== "understudy") {
    throw new UnsupportedAdapterError("Internal MCP server", value);
  }
}

async function runInternalMcpServer(argv: string[]): Promise<void> {
  const [serverType, ...rest] = argv;
  if (!serverType) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  assertMcpServerType(serverType);
  const { values } = parseArgs({
    args: rest,
    options: {
      "cdp-url": { type: "string" },
      model: { type: "string" },
      mode: { type: "string" },
      provider: { type: "string" },
      "execution-model": { type: "string" },
      "exclude-tool": { type: "string", multiple: true },
      "tool-timeout": { type: "string" },
    },
  });

  if (!values["cdp-url"]) {
    throw new Error(`Internal MCP server "${serverType}" requires --cdp-url.`);
  }

  if (serverType === "stagehand-agent") {
    await startStagehandAgentMCPServer({
      cdpUrl: values["cdp-url"],
      model: values.model,
      mode:
        values.mode === "dom" ||
        values.mode === "hybrid" ||
        values.mode === "cua"
          ? values.mode
          : undefined,
      provider: values.provider,
      executionModel: values["execution-model"],
      excludeTools: readList(values["exclude-tool"]),
      toolTimeout: values["tool-timeout"]
        ? Number(values["tool-timeout"])
        : undefined,
    });
    return;
  }

  await startUnderstudyMcpServer({
    cdpUrl: values["cdp-url"],
  });
}

async function main(): Promise<void> {
  const [command = "run", ...rest] = process.argv.slice(2);

  if (command === "run") {
    await runCommand(rest);
    return;
  }

  if (command === "mcp-server") {
    await runInternalMcpServer(rest);
    return;
  }

  // Allow `multiagent "task"` as shorthand.
  if (!command.startsWith("-")) {
    await runCommand([command, ...rest]);
    return;
  }

  await runCommand([command, ...rest]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
