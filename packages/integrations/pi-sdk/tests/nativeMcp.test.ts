import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { loadPiSdk, type PiAgentSessionLike } from "../src/session.js";

it("connects native MCP tools, preserves results, and closes the child on disposal", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "stagehand-pi-native-"));
  const pidPath = join(cwd, "server.pid");
  let session: PiAgentSessionLike | undefined;
  // Exercise Pi's real stdio transport without launching a browser or calling a model.
  const server = `
    import { writeFileSync } from "node:fs";
    import { createInterface } from "node:readline";
    writeFileSync(process.argv[1], String(process.pid));
    createInterface({ input: process.stdin }).on("line", line => {
      const request = JSON.parse(line);
      if (request.id === undefined) return;
      let result = {};
      if (request.method === "initialize") {
        result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } };
      } else if (request.method === "tools/list") {
        result = { tools: [{ name: "take-shot", description: "Fixture", inputSchema: { type: "object", properties: { fail: { type: "boolean" } } } }] };
      } else if (request.method === "tools/call") {
        result = request.params.arguments?.fail
          ? { isError: true, content: [{ type: "text", text: "fixture failure" }] }
          : { content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }], structuredContent: { snapshotId: "shot" } };
      }
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

    const tool = agent.state.tools[0];
    const result = await tool.execute("shot", {}, undefined, undefined);
    expect(result).toMatchObject({
      content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
      details: { server: "stage-hand", tool: "take-shot" },
      structuredContent: { structuredContent: { snapshotId: "shot" } },
    });
    const failure = await tool.execute("failure", { fail: true }, undefined, undefined);
    expect(failure).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "fixture failure" }],
    });

    const pid = Number(await readFile(pidPath, "utf8"));
    await session.dispose();
    await session.dispose();
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
  } finally {
    await session?.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
}, 15000);
