import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  BROWSE_CLI_MCP_TOOL_NAME,
  startBrowseCliMcpBridge,
  tokenizeBrowseCommand,
} from "../../framework/browseCliMcpBridge.js";
import { EvalLogger } from "../../logger.js";

/** Stands in for the pinned `browse` wrapper: echoes argv, one token per line. */
const FAKE_WRAPPER = [
  "#!/usr/bin/env bash",
  'if [[ "${1:-}" == "boom" ]]; then',
  '  echo "browse: nope" >&2',
  "  exit 3",
  "fi",
  'for arg in "$@"; do echo "$arg"; done',
  "",
].join("\n");

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function startBridge(): Promise<Client> {
  const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "stagehand-evals-browse-mcp-test-"));
  const wrapperPath = path.join(cwd, "browse");
  await fsp.writeFile(wrapperPath, FAKE_WRAPPER, { mode: 0o755 });
  const bridge = await startBrowseCliMcpBridge({
    wrapperPath,
    cwd,
    env: { ...process.env } as Record<string, string>,
    logger: new EvalLogger(false),
    logCategory: "deepagents",
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: bridge.mcpServerSpec.command,
      args: bridge.mcpServerSpec.args,
      env: bridge.mcpServerSpec.env,
    }),
  );
  cleanups.push(async () => {
    try {
      await client.close();
    } catch {
      // the relay may already be gone
    }
    await bridge.close();
    await fsp.rm(cwd, { recursive: true, force: true });
  });
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map((part) => part.text ?? "").join("\n");
}

describe("tokenizeBrowseCommand", () => {
  it("splits on whitespace and drops the browse prefix", () => {
    expect(tokenizeBrowseCommand("browse open https://example.com")).toEqual([
      "open",
      "https://example.com",
    ]);
  });

  it("keeps quoted arguments intact", () => {
    expect(tokenizeBrowseCommand(`browse fill "#q" 'two words'`)).toEqual([
      "fill",
      "#q",
      "two words",
    ]);
    expect(tokenizeBrowseCommand(`browse type a\\ b`)).toEqual(["type", "a b"]);
    expect(tokenizeBrowseCommand(`browse type ""`)).toEqual(["type", ""]);
  });

  it("rejects unterminated quotes and non-browse commands", () => {
    expect(() => tokenizeBrowseCommand(`browse fill "oops`)).toThrow(/Unterminated/);
    expect(() => tokenizeBrowseCommand("curl https://example.com")).toThrow(/Only browse commands/);
  });
});

describe("browse_cli MCP bridge", () => {
  it("exposes a single browse tool", async () => {
    const client = await startBridge();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([BROWSE_CLI_MCP_TOOL_NAME]);
    expect(tools[0].inputSchema.required).toEqual(["command"]);
  });

  it("runs one browse command per call and returns its output", async () => {
    const client = await startBridge();
    const result = await client.callTool({
      name: BROWSE_CLI_MCP_TOOL_NAME,
      arguments: { command: `browse fill "#q" 'two words'` },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe("fill\n#q\ntwo words");
  });

  it("reports CLI failures as tool errors", async () => {
    const client = await startBridge();
    const result = await client.callTool({
      name: BROWSE_CLI_MCP_TOOL_NAME,
      arguments: { command: "browse boom" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("nope");
  });

  it("refuses anything that is not a bare browse command", async () => {
    const client = await startBridge();
    for (const command of ["ls -la", "browse open https://example.com | tee out", "browse `id`"]) {
      const result = await client.callTool({
        name: BROWSE_CLI_MCP_TOOL_NAME,
        arguments: { command },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("Only browse commands are allowed");
    }
  });
});
