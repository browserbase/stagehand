import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

const entrypoint = fileURLToPath(new URL("../dist/codemode/stdio-server.mjs", import.meta.url));
const baseEnv = {
  PATH: process.env.PATH ?? "",
  STAGEHAND_BROWSER: "local",
};

function startServer(env: NodeJS.ProcessEnv = baseEnv): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [entrypoint], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function waitForReady(child: ChildProcessWithoutNullStreams): Promise<string> {
  let stderr = "";
  return await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`stdio server did not start: ${stderr}`)),
      10_000,
    );
    const onData = (chunk: Buffer) => {
      stderr += chunk.toString();
      if (!stderr.includes("Stagehand code-mode MCP listening on stdio")) return;
      clearTimeout(timeout);
      child.stderr.off("data", onData);
      resolve(stderr);
    };
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(`stdio server exited before ready (code=${code}, signal=${signal}): ${stderr}`),
      );
    });
  });
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("stdio server did not exit within 10 seconds"));
    }, 10_000);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

describe("built code-mode stdio server", () => {
  it("starts in explicit local mode and exits successfully on stdin EOF", async () => {
    const child = startServer({
      ...baseEnv,
      BROWSERBASE_API_KEY: "unused-browserbase-key",
      BROWSERBASE_PROJECT_ID: "unused-project-id",
    });
    try {
      await waitForReady(child);
      const exit = waitForExit(child);
      child.stdin.end();
      await expect(exit).resolves.toStrictEqual({ code: 0, signal: null });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  });

  it.skipIf(process.platform === "win32")(
    "preserves SIGINT and SIGTERM exit semantics",
    async () => {
      for (const [signal, expectedCode] of [
        ["SIGINT", 130],
        ["SIGTERM", 143],
      ] as const) {
        const child = startServer();
        try {
          await waitForReady(child);
          const exit = waitForExit(child);
          child.kill(signal);
          await expect(exit).resolves.toStrictEqual({ code: expectedCode, signal: null });
        } finally {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }
      }
    },
    30_000,
  );

  it("fails startup for an invalid browser mode", async () => {
    const child = startServer({ ...baseEnv, STAGEHAND_BROWSER: "remote" });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const exit = await waitForExit(child);

    expect(exit.code).not.toBe(0);
    expect(stderr).toContain('STAGEHAND_BROWSER must be either "local" or "browserbase".');
  });

  it("supports MCP initialization, discovery, and validation through the compiled child", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint],
      env: baseEnv,
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const client = new Client({ name: "stagehand-codemode-stdio-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toStrictEqual(["code_execute"]);
      await expect(
        client.callTool({ name: "code_execute", arguments: { code: "   " } }),
      ).resolves.toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: expect.stringContaining("code must contain JavaScript source"),
          },
        ],
      });
      expect(stderr).toContain("Stagehand code-mode MCP listening on stdio");
    } finally {
      await client.close();
    }
  });
});
