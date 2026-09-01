import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentMount } from "../../core/contracts/tool.js";
import { EvalsError } from "../../errors.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import {
  EVE_MCP_SERVERS_ENV,
  listMcpServerTools,
  prepareEveToolAdapter,
} from "../../framework/eveToolAdapter.js";
import { EvalLogger } from "../../logger.js";

const { startAgentToolRuntimeMock } = vi.hoisted(() => ({
  startAgentToolRuntimeMock: vi.fn(),
}));

vi.mock("../../framework/agentToolRuntime.js", () => ({
  startAgentToolRuntime: startAgentToolRuntimeMock,
}));

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Find the checkout button",
};

const tempRoots = new Set<string>();

afterEach(async () => {
  startAgentToolRuntimeMock.mockReset();
  await Promise.all([...tempRoots].map((root) => fsp.rm(root, { recursive: true, force: true })));
  tempRoots.clear();
});

async function tempInput() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "eve-adapter-prepare-test-"));
  tempRoots.add(root);
  const nodeModulesDir = path.join(root, "modules");
  const tmpRoot = path.join(root, "tmp");
  await fsp.mkdir(nodeModulesDir);
  await fsp.mkdir(tmpRoot);
  await fsp.writeFile(path.join(nodeModulesDir, "marker"), "keep");
  return { nodeModulesDir, tmpRoot };
}

function setRuntime(
  agentMount: AgentMount,
  options?: { captureEvidence?: () => Promise<{ url: string }>; cleanup?: () => Promise<void> },
) {
  const cleanup = vi.fn(options?.cleanup ?? (async () => undefined));
  startAgentToolRuntimeMock.mockResolvedValue({
    running: {
      agentMount,
      ...(options?.captureEvidence && { captureEvidence: options.captureEvidence }),
    },
    cleanup,
  });
  return cleanup;
}

function adapterInput(paths: Awaited<ReturnType<typeof tempInput>>) {
  return {
    environment: "LOCAL" as const,
    plan,
    logger: new EvalLogger(false),
    ...paths,
  };
}

describe("prepareEveToolAdapter", () => {
  it("rejects non-MCP mounts and cleans up the runtime", async () => {
    const paths = await tempInput();
    const cleanup = setRuntime({
      via: "handles",
      promptInstructions: "Use the browser.",
      handles: {},
      runTool: { description: "run", codeParamDescription: "code", denyMessage: "denied" },
    });

    await expect(prepareEveToolAdapter(adapterInput(paths))).rejects.toMatchObject({
      name: EvalsError.name,
      message: expect.stringMatching(/not supported yet/),
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("rejects malformed server specs without leaking an app directory", async () => {
    const paths = await tempInput();
    const cleanup = setRuntime({
      via: "mcp",
      promptInstructions: "Use the browser.",
      mcpServers: { stagehand: { args: [] } },
    });

    await expect(prepareEveToolAdapter(adapterInput(paths))).rejects.toThrow(
      /must provide a string command/,
    );
    expect(cleanup).toHaveBeenCalledOnce();
    expect(await fsp.readdir(paths.tmpRoot)).toEqual([]);
  });

  it("rejects MCP servers that list no tools", async () => {
    const paths = await tempInput();
    const cleanup = setRuntime({
      via: "mcp",
      promptInstructions: "Use the browser.",
      mcpServers: { stagehand: { command: "node" } },
    });

    await expect(
      prepareEveToolAdapter({
        ...adapterInput(paths),
        listMcpTools: vi.fn(async () => []),
      }),
    ).rejects.toThrow(/listed no tools/);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("wires the MCP mount, generated app, matcher, and environment", async () => {
    const paths = await tempInput();
    const spec = { command: "node", args: ["server.js"], env: { A: "1" } };
    const mcpServers = { stagehand: spec };
    const listMcpTools = vi.fn(async () => [{ name: "act", inputSchema: { type: "object" } }]);
    setRuntime({
      via: "mcp",
      promptInstructions: "Use the mounted tools.",
      mcpServers,
    });

    const result = await prepareEveToolAdapter({
      ...adapterInput(paths),
      listMcpTools,
    });
    expect(listMcpTools).toHaveBeenCalledWith(spec);
    expect(JSON.parse(result.env[EVE_MCP_SERVERS_ENV] ?? "null")).toEqual(mcpServers);
    expect(result.serverNames).toEqual(["stagehand"]);
    expect(result.toolNames).toEqual(["stagehand__act"]);
    expect(result.observedToolMatcher("stagehand__act")).toBe(true);
    expect(result.observedToolMatcher("other__act")).toBe(false);
    expect(result.observedToolMatcher("bash")).toBe(false);
    expect(result.promptInstructions).toBe("Use the mounted tools.");
    expect(path.dirname(result.appRoot)).toBe(paths.tmpRoot);
    expect(
      await fsp.stat(path.join(result.appRoot, "agent", "tools", "stagehand__act.ts")),
    ).toBeDefined();
    expect((await fsp.lstat(path.join(result.appRoot, "node_modules"))).isSymbolicLink()).toBe(
      true,
    );
    await result.cleanup();
  });

  it("records evidence observations and omits capture hooks when unavailable", async () => {
    const paths = await tempInput();
    const captureEvidence = vi.fn(async () => ({ url: "https://example.com" }));
    setRuntime(
      {
        via: "mcp",
        promptInstructions: "Use the browser.",
        mcpServers: { stagehand: { command: "node" } },
      },
      { captureEvidence },
    );
    const result = await prepareEveToolAdapter({
      ...adapterInput(paths),
      listMcpTools: vi.fn(async () => [{ name: "act", inputSchema: { type: "object" } }]),
    });

    expect(result.captureEvidence).toBeDefined();
    expect(result.recordObservation).toBeDefined();
    expect(result.drainStepObservations).toBeDefined();
    result.recordObservation?.();
    result.recordObservation?.();
    expect(await result.drainStepObservations?.()).toEqual([
      { runIndex: 0, evidence: { url: "https://example.com" } },
      { runIndex: 1, evidence: { url: "https://example.com" } },
    ]);
    await result.cleanup();

    const pathsWithoutCapture = await tempInput();
    setRuntime({
      via: "mcp",
      promptInstructions: "Use the browser.",
      mcpServers: { stagehand: { command: "node" } },
    });
    const withoutCapture = await prepareEveToolAdapter({
      ...adapterInput(pathsWithoutCapture),
      listMcpTools: vi.fn(async () => [{ name: "act", inputSchema: { type: "object" } }]),
    });
    expect(withoutCapture.captureEvidence).toBeUndefined();
    expect(withoutCapture.recordObservation).toBeUndefined();
    expect(withoutCapture.drainStepObservations).toBeUndefined();
    await withoutCapture.cleanup();
  });

  it("makes cleanup idempotent and preserves shared node_modules", async () => {
    const paths = await tempInput();
    const cleanup = setRuntime({
      via: "mcp",
      promptInstructions: "Use the browser.",
      mcpServers: { stagehand: { command: "node" } },
    });
    const result = await prepareEveToolAdapter({
      ...adapterInput(paths),
      listMcpTools: vi.fn(async () => [{ name: "act", inputSchema: { type: "object" } }]),
    });

    await Promise.all([result.cleanup(), result.cleanup()]);
    await result.cleanup();
    expect(cleanup).toHaveBeenCalledOnce();
    await expect(fsp.stat(result.appRoot)).rejects.toThrow();
    expect(await fsp.readFile(path.join(paths.nodeModulesDir, "marker"), "utf8")).toBe("keep");
  });

  it("removes the app when runtime cleanup rejects or times out", async () => {
    const rejectedPaths = await tempInput();
    setRuntime(
      {
        via: "mcp",
        promptInstructions: "Use the browser.",
        mcpServers: { stagehand: { command: "node" } },
      },
      { cleanup: async () => Promise.reject(new Error("cleanup failed")) },
    );
    const rejected = await prepareEveToolAdapter({
      ...adapterInput(rejectedPaths),
      listMcpTools: vi.fn(async () => [{ name: "act", inputSchema: { type: "object" } }]),
    });
    await expect(rejected.cleanup()).resolves.toBeUndefined();
    await expect(fsp.stat(rejected.appRoot)).rejects.toThrow();

    const previousTimeout = process.env.EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS;
    process.env.EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS = "20";
    try {
      const timedOutPaths = await tempInput();
      setRuntime(
        {
          via: "mcp",
          promptInstructions: "Use the browser.",
          mcpServers: { stagehand: { command: "node" } },
        },
        { cleanup: () => new Promise<void>(() => undefined) },
      );
      const timedOut = await prepareEveToolAdapter({
        ...adapterInput(timedOutPaths),
        listMcpTools: vi.fn(async () => [{ name: "act", inputSchema: { type: "object" } }]),
      });
      await expect(timedOut.cleanup()).resolves.toBeUndefined();
      await expect(fsp.stat(timedOut.appRoot)).rejects.toThrow();
    } finally {
      if (previousTimeout === undefined) delete process.env.EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS;
      else process.env.EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS = previousTimeout;
    }
  });

  it("cleans up runtime and temp files when tool discovery throws", async () => {
    const paths = await tempInput();
    const cleanup = setRuntime({
      via: "mcp",
      promptInstructions: "Use the browser.",
      mcpServers: { stagehand: { command: "node" } },
    });
    const failure = new Error("list failed");

    await expect(
      prepareEveToolAdapter({
        ...adapterInput(paths),
        listMcpTools: vi.fn(async () => Promise.reject(failure)),
      }),
    ).rejects.toBe(failure);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(await fsp.readdir(paths.tmpRoot)).toEqual([]);
  });
});

describe("listMcpServerTools", () => {
  type Options = NonNullable<Parameters<typeof listMcpServerTools>[1]>;
  type Connect = NonNullable<Options["connect"]>;

  it("times out a connection that never resolves", async () => {
    let receivedSignal: AbortSignal | undefined;
    const connect = vi.fn((_spec, signal) => {
      receivedSignal = signal;
      return new Promise<never>(() => undefined);
    }) as unknown as Connect;
    await expect(
      listMcpServerTools({ command: "stuck-server" }, { connect, timeoutMs: 20 }),
    ).rejects.toThrow(/stuck-server.*timed out/);
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("closes a client that finishes connecting after the timeout", async () => {
    const close = vi.fn(async () => undefined);
    const client = { listTools: vi.fn(), close };
    let finishConnect: ((value: typeof client) => void) | undefined;
    const connect = vi.fn(
      () =>
        new Promise<typeof client>((resolve) => {
          finishConnect = resolve;
        }),
    ) as unknown as Connect;

    await expect(
      listMcpServerTools({ command: "slow-server" }, { connect, timeoutMs: 20 }),
    ).rejects.toThrow(/slow-server.*timed out/);
    finishConnect?.(client);

    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(client.listTools).not.toHaveBeenCalled();
  });

  it("times out tool listing and still closes the client", async () => {
    const close = vi.fn(async () => undefined);
    const client = { listTools: () => new Promise<never>(() => undefined), close };
    const connect = vi.fn(async () => client) as unknown as Connect;
    await expect(
      listMcpServerTools({ command: "node" }, { connect, timeoutMs: 20 }),
    ).rejects.toThrow(/timed out/);
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns listed tools, closes the client, and passes string-only environment values", async () => {
    const close = vi.fn(async () => undefined);
    const tools = [{ name: "act", description: "Act", inputSchema: { type: "object" } }];
    const client = { listTools: vi.fn(async () => ({ tools })), close };
    const connectMock = vi.fn(
      async (_config: { command: string; args?: string[]; env?: Record<string, string> }) => client,
    );
    const connect = connectMock as unknown as Connect;

    await expect(
      listMcpServerTools(
        { command: "node", args: ["server.js"], env: { EVE_TEST_VALUE: "1" } },
        { connect, timeoutMs: 20 },
      ),
    ).resolves.toEqual(tools);
    expect(close).toHaveBeenCalledOnce();
    expect(connectMock).toHaveBeenCalledOnce();
    const config = connectMock.mock.calls[0]?.[0];
    expect(config).toMatchObject({
      command: "node",
      args: ["server.js"],
      env: expect.objectContaining({ EVE_TEST_VALUE: "1" }),
    });
    expect(Object.values(config?.env ?? {}).every((value) => typeof value === "string")).toBe(true);
  });
});
