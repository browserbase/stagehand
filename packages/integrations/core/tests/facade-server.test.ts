import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Stream } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FACADE_LEGACY_TOOLS, FACADE_TOOLS } from "../src/facade/contract.js";

const entrypoint = fileURLToPath(new URL("../dist/facade/stdio-server.mjs", import.meta.url));
const readyMessage = "Stagehand facade MCP host listening on stdio";

describe("built Stagehand facade stdio server", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "facade-stdio-logs-"));
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint],
      env: {
        PATH: process.env.PATH ?? "",
        STAGEHAND_BROWSER: "invalid",
        STAGEHAND_FACADE_LOG_LEVEL: "debug",
        STAGEHAND_FACADE_LOG_FILE: path.join(directory, "tools.jsonl"),
      },
      stderr: "pipe",
    });
    if (!transport.stderr) throw new Error("stdio transport did not expose stderr");
    const ready = waitForOutput(transport.stderr, readyMessage);
    client = new Client({ name: "stagehand-facade-test", version: "1.0.0" });
    await Promise.all([client.connect(transport), ready]);
  });

  afterEach(async () => {
    await client.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("initializes and lists the exact tools without launching a browser", async () => {
    expect(client.getServerVersion()).toMatchObject({ name: "stagehand-facade" });
    const result = await client.listTools();
    expect(result.tools).toStrictEqual([...FACADE_TOOLS]);
  });

  it("returns tool errors for invalid calls without crashing", async () => {
    const invalidRun = await client.callTool({ name: "run", arguments: {} });
    expect(invalidRun.isError).toBe(true);
    expect(invalidRun.content[0]).toMatchObject({ type: "text" });

    const unknown = await client.callTool({ name: "missing", arguments: {} });
    expect(unknown.isError).toBe(true);

    const logs = (await fs.readFile(path.join(directory, "tools.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(logs.map((record) => record.event)).toEqual([
      "tool.start",
      "tool.end",
      "tool.start",
      "tool.end",
    ]);
    expect(logs[0]).toMatchObject({ name: "run", arguments: {} });
    expect(logs[1]).toMatchObject({ id: logs[0].id, status: "error" });
    expect(logs[3].result.isError).toBe(true);

    await expect(client.ping()).resolves.toBeDefined();
  });

  it("accepts numeric screenshot quality and rejects booleans", async () => {
    const numeric = await client.callTool({
      name: "screenshot",
      arguments: { quality: 80.0 },
    });
    expect(numeric.isError).toBe(true);
    expect(textContent(numeric)).toContain("STAGEHAND_BROWSER");
    expect(textContent(numeric)).not.toContain("expected number");

    const boolean = await client.callTool({
      name: "screenshot",
      arguments: { quality: true },
    });
    expect(boolean.isError).toBe(true);
    expect(textContent(boolean)).toContain("expected number");

    await expect(client.ping()).resolves.toBeDefined();
  });
});

describe("built Stagehand facade stdio server with --surface=legacy", () => {
  it("lists the legacy run description", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint, "--surface=legacy"],
      env: { PATH: process.env.PATH ?? "", STAGEHAND_BROWSER: "invalid" },
      stderr: "pipe",
    });
    if (!transport.stderr) throw new Error("stdio transport did not expose stderr");
    const ready = waitForOutput(transport.stderr, readyMessage);
    const client = new Client({ name: "stagehand-facade-test", version: "1.0.0" });
    try {
      await Promise.all([client.connect(transport), ready]);
      const result = await client.listTools();
      expect(result.tools).toStrictEqual([...FACADE_LEGACY_TOOLS]);
      expect(result.tools[0].description).not.toBe(FACADE_TOOLS[0].description);
    } finally {
      await client.close();
    }
  });
});

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const block = result.content[0];
  return block && block.type === "text" ? block.text : "";
}

function waitForOutput(stream: Stream, expected: string): Promise<string> {
  let output = "";
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`stdio host did not emit ${JSON.stringify(expected)}: ${output}`));
    }, 10_000);
    const cleanup = () => {
      clearTimeout(timeout);
      stream.off("data", onData);
      stream.off("error", onError);
      stream.off("end", onEnd);
      stream.off("close", onEnd);
    };
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (!output.includes(expected)) return;
      cleanup();
      resolve(output);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error(`stdio output stream ended before ${JSON.stringify(expected)}: ${output}`));
    };
    stream.on("data", onData);
    stream.on("error", onError);
    stream.once("end", onEnd);
    stream.once("close", onEnd);
  });
}
