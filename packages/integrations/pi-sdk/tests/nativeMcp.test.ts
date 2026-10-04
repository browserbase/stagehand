import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { loadPiSdk, type PiAgentSessionLike } from "../src/session.js";

it("loads only native MCP tools and closes the stdio child on disposal", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "stagehand-pi-mcp-"));
  const pidPath = join(cwd, "server.pid");
  let session: PiAgentSessionLike | undefined;
  // A minimal stdio server exercises Pi's real transport without a browser or model call.
  const server = `
    import { writeFileSync } from "node:fs";
    import { createInterface } from "node:readline";
    writeFileSync(process.argv[1], String(process.pid));
    createInterface({ input: process.stdin }).on("line", (line) => {
      const request = JSON.parse(line);
      if (request.id === undefined) return;
      const result = request.method === "initialize"
        ? { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
        : request.method === "tools/list"
          ? { tools: [{ name: "take-shot", description: "Fixture", inputSchema: { type: "object", properties: {} } }] }
          : {};
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
    });
  `;
  try {
    const sdk = await loadPiSdk();
    session = await sdk.createSession({
      model: "openai/gpt-5.4-mini",
      cwd,
      mcpServers: {
        "stage-hand": {
          command: process.execPath,
          args: ["--input-type=module", "-e", server, pidPath],
        },
      },
    });
    const agent = session.agent as AgentSession["agent"];
    expect(agent.toolExecution).toBe("sequential");
    await vi.waitFor(
      () => {
        expect(agent.state.tools.map((tool) => tool.name)).toEqual(["mcp__stage_hand__take_shot"]);
      },
      { timeout: 5000 },
    );
    const pid = Number(await readFile(pidPath, "utf8"));
    await session.dispose();
    await session.dispose();
    await vi.waitFor(() => {
      expect(() => process.kill(pid, 0)).toThrow();
    });
  } finally {
    await session?.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
}, 10000);
