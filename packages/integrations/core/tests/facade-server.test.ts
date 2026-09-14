import { fileURLToPath } from "node:url";
import type { Stream } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FACADE_TOOLS } from "../src/facade/contract.js";

const entrypoint = fileURLToPath(new URL("../dist/facade/stdio-server.mjs", import.meta.url));
const readyMessage = "Stagehand facade MCP host listening on stdio";

describe("built Stagehand facade stdio server", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeEach(async () => {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint],
      env: { PATH: process.env.PATH ?? "", STAGEHAND_BROWSER: "invalid" },
      stderr: "pipe",
    });
    if (!transport.stderr) throw new Error("stdio transport did not expose stderr");
    const ready = waitForOutput(transport.stderr, readyMessage);
    client = new Client({ name: "stagehand-facade-test", version: "1.0.0" });
    await Promise.all([client.connect(transport), ready]);
  });

  afterEach(async () => {
    await client.close();
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
